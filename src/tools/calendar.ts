import type { calendar_v3 } from "@googleapis/calendar";
import { dataBlock } from "../server/data-block.js";

export type Calendar = Pick<calendar_v3.Calendar, "events">;
type Event = calendar_v3.Schema$Event;

const MAX_DESCRIPTION = 4000;

export async function listEvents(cal: Calendar, opts: { from?: string; to?: string; query?: string; max: number }): Promise<string> {
  const timeMin = opts.from ? new Date(opts.from) : new Date();
  const timeMax = opts.to ? new Date(opts.to) : new Date(timeMin.getTime() + 7 * 86_400_000);
  if (Number.isNaN(timeMin.getTime()) || Number.isNaN(timeMax.getTime())) throw new Error("from and to must be dates like 2026-11-03 or 2026-11-03T09:00:00+08:00.");
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: opts.max,
    ...(opts.query ? { q: opts.query } : {}),
  });
  const events = res.data.items ?? [];
  if (events.length === 0) return `No events between ${timeMin.toISOString()} and ${timeMax.toISOString()}.`;
  return dataBlock("calendar/events", events.map(formatEvent).join("\n\n---\n\n"));
}

export async function readEvent(cal: Calendar, eventId: string): Promise<string> {
  const res = await cal.events.get({ calendarId: "primary", eventId });
  return dataBlock(`calendar/event/${eventId}`, formatEvent(res.data));
}

export async function eventText(cal: Calendar, eventId: string): Promise<string> {
  const { data } = await cal.events.get({ calendarId: "primary", eventId });
  return `${data.summary ?? ""}\n${data.description ?? ""}`;
}

function formatEvent(e: Event): string {
  const when = (t: calendar_v3.Schema$EventDateTime | undefined) => t?.dateTime ?? t?.date ?? "";
  const lines = [`event_id: ${e.id}`, `title: ${e.summary ?? ""}`, `start: ${when(e.start)}`, `end: ${when(e.end)}`];
  if (e.organizer?.email) lines.push(`organizer: ${e.organizer.email}`);
  const attendees = (e.attendees ?? []).map((a) => `${a.displayName ? `${a.displayName} ` : ""}<${a.email}> (${a.responseStatus ?? "unknown"})`);
  if (attendees.length) lines.push(`attendees: ${attendees.join(", ")}`);
  if (e.location) lines.push(`location: ${e.location}`);
  if (e.hangoutLink) lines.push(`meet: ${e.hangoutLink}`);
  const desc = (e.description ?? "").replace(/<[^>]+>/g, " ").trim();
  if (desc) lines.push("", desc.length > MAX_DESCRIPTION ? `${desc.slice(0, MAX_DESCRIPTION)} [...]` : desc);
  return lines.join("\n");
}
