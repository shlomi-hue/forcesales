import { describe, expect, it } from "vitest";
import type { Calendar } from "../../src/tools/calendar.js";
import type { Drive } from "../../src/tools/drive.js";
import { findNotes, listMeetingsWithNotes, readMeetingNotes } from "../../src/tools/meetings.js";

const event = (attachments: { title: string; fileId: string }[] = []) => ({
  id: "ev-1",
  summary: "Acme pricing call",
  start: { dateTime: "2026-10-27T10:00:00+08:00" },
  attendees: [{ email: "dana@acme.example" }],
  attachments,
});

function fakes(ev: ReturnType<typeof event>, driveFiles: { id: string; name: string }[] = []) {
  const queries: string[] = [];
  const cal = { events: { get: async () => ({ data: ev }), list: async () => ({ data: { items: [ev] } }) } } as unknown as Calendar;
  const drive = {
    files: {
      list: async ({ q }: { q: string }) => {
        queries.push(q);
        return { data: { files: driveFiles } };
      },
      get: async () => ({ data: { name: "notes", mimeType: "application/vnd.google-apps.document" } }),
      export: async () => ({ data: "Summary\nDana wants SSO by March.\nSuggested next steps\nDana Lee will send the questionnaire." }),
    },
  } as unknown as Drive;
  return { cal, drive, queries };
}

describe("Gemini meeting notes", () => {
  it("uses the notes Doc attached to the event", async () => {
    const { cal, drive, queries } = fakes(event([{ title: "Acme pricing call - 2026/10/27 - Notes by Gemini", fileId: "notes-1" }]));
    expect(await findNotes(cal, drive, event([{ title: "Acme pricing call - Notes by Gemini", fileId: "notes-1" }]))).toMatchObject({ fileId: "notes-1" });
    const out = await readMeetingNotes(cal, drive, "ev-1");
    expect(out).toMatch(/source="drive\/file\/notes-1"/);
    expect(out).toContain("source for signals and promises: drive/file/notes-1");
    expect(out).toContain("Dana Lee will send the questionnaire.");
    expect(queries).toEqual([]);
  });

  it("falls back to a Drive search by title and date, escaping quotes", async () => {
    const ev = { ...event(), summary: "Acme's pricing call" };
    const { cal, drive, queries } = fakes(ev, [{ id: "notes-2", name: "Acme's pricing call - Notes by Gemini" }]);
    expect(await findNotes(cal, drive, ev)).toMatchObject({ fileId: "notes-2" });
    expect(queries[0]).toContain("name contains 'Notes by Gemini'");
    expect(queries[0]).toContain("name contains 'Acme\\'s pricing call'");
    expect(queries[0]).toContain("modifiedTime > '2026-10-26T02:00:00.000Z'");
  });

  it("says plainly when there are no notes, and lists meetings", async () => {
    const { cal, drive } = fakes(event());
    expect(await readMeetingNotes(cal, drive, "ev-1")).toContain("No Gemini notes found");
    expect(await listMeetingsWithNotes(cal, { max: 10 })).toContain("notes: not attached");
  });
});
