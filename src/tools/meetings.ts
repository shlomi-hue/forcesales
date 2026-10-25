// Gemini meeting notes. Google Meet's "Take notes for me" saves a Google Doc named
// "<meeting> - <date> - Notes by Gemini" and attaches it to the Calendar event.
// We read those notes rather than transcribing anything.

import type { calendar_v3 } from "@googleapis/calendar";
import { dataBlock } from "../server/data-block.js";
import type { Calendar } from "./calendar.js";
import { driveText, type Drive } from "./drive.js";

type Event = calendar_v3.Schema$Event;

const NOTES_TITLE = /notes by gemini/i;
const GOOGLE_DOC = "application/vnd.google-apps.document";

export interface FoundNotes {
  fileId: string;
  title: string;
}

// The notes Doc for an event: an attachment first, then a Drive search by title and date.
export async function findNotes(cal: Calendar, drive: Drive, event: Event): Promise<FoundNotes | null> {
  const attached = (event.attachments ?? []).find((a) => a.fileId && NOTES_TITLE.test(a.title ?? ""));
  if (attached?.fileId) return { fileId: attached.fileId, title: attached.title ?? "" };

  const start = new Date(event.start?.dateTime ?? event.start?.date ?? "");
  if (Number.isNaN(start.getTime())) return null;
  const after = new Date(start.getTime() - 86_400_000).toISOString();
  const before = new Date(start.getTime() + 3 * 86_400_000).toISOString();
  const title = (event.summary ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const q = [
    `mimeType = '${GOOGLE_DOC}'`,
    "name contains 'Notes by Gemini'",
    ...(title ? [`name contains '${title}'`] : []),
    `modifiedTime > '${after}'`,
    `modifiedTime < '${before}'`,
    "trashed = false",
  ].join(" and ");
  const res = await drive.files.list({ q, pageSize: 5, fields: "files(id,name,modifiedTime)", orderBy: "modifiedTime" });
  const file = res.data.files?.[0];
  return file?.id ? { fileId: file.id, title: file.name ?? "" } : null;
}

export async function readMeetingNotes(cal: Calendar, drive: Drive, eventId: string): Promise<string> {
  const { data: event } = await cal.events.get({ calendarId: "primary", eventId });
  const notes = await findNotes(cal, drive, event);
  if (!notes) {
    return `No Gemini notes found for "${event.summary ?? eventId}". They exist only when "Take notes for me" was on in Meet, and only once Gemini has finished them (usually minutes after the call).`;
  }
  const { text } = await driveText(drive, notes.fileId);
  const head = [
    `meeting: ${event.summary ?? ""}`,
    `start: ${event.start?.dateTime ?? event.start?.date ?? ""}`,
    `attendees: ${(event.attendees ?? []).map((a) => a.email).join(", ")}`,
    `notes: ${notes.title}`,
    `source for signals and promises: drive/file/${notes.fileId}`,
  ];
  return dataBlock(`drive/file/${notes.fileId}`, `${head.join("\n")}\n\n${text}`);
}

// Past meetings in a window, and whether each has notes attached.
export async function listMeetingsWithNotes(cal: Calendar, opts: { from?: string; to?: string; query?: string; max: number }): Promise<string> {
  const timeMax = opts.to ? new Date(opts.to) : new Date();
  const timeMin = opts.from ? new Date(opts.from) : new Date(timeMax.getTime() - 14 * 86_400_000);
  if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) throw new Error("from and to must be dates like 2026-11-03.");
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: opts.max,
    ...(opts.query ? { q: opts.query } : {}),
  });
  const rows = (res.data.items ?? []).map((e) => {
    const notes = (e.attachments ?? []).find((a) => NOTES_TITLE.test(a.title ?? ""));
    return `event_id: ${e.id}\ntitle: ${e.summary ?? ""}\nstart: ${e.start?.dateTime ?? e.start?.date ?? ""}\nattendees: ${(e.attendees ?? []).map((a) => a.email).join(", ")}\nnotes: ${notes ? `attached (file_id: ${notes.fileId})` : "not attached (meeting_notes will search Drive)"}`;
  });
  if (rows.length === 0) return `No meetings between ${timeMin.toISOString()} and ${timeMax.toISOString()}.`;
  return dataBlock("calendar/meetings", rows.join("\n\n"));
}
