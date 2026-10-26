import { readFileSync } from "node:fs";
import type { gmail_v1 } from "@googleapis/gmail";
import type { Gmail } from "../../src/tools/gmail.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRateCard } from "../../src/checks/rate-card.js";
import type { ServerDeps } from "../../src/server/server.js";
import type { Calendar } from "../../src/tools/calendar.js";
import type { Drive } from "../../src/tools/drive.js";
import type { Sheets } from "../../src/tools/sheets.js";
import { sourceReader } from "../../src/tools/sources.js";
import { simple } from "../checks/fixtures.js";

// A recorded-thread stand-in for the Gmail client. Records every draft it's asked to create.
// sentTo: addresses or domains the fake account has "sent mail to before".
export function fakeGmail(opts: { threadFile?: string; thread?: gmail_v1.Schema$Thread; sentTo?: string[] } = {}) {
  const thread = opts.thread ?? (JSON.parse(readFileSync(opts.threadFile ?? "test/fixtures/gmail-thread.json", "utf8")) as gmail_v1.Schema$Thread);
  const sentTo = opts.sentTo ?? [];
  const drafts: gmail_v1.Schema$Draft[] = [];
  const gmail = {
    users: {
      getProfile: async () => ({ data: { emailAddress: "me@seller.example" } }),
      threads: {
        get: async ({ id }: { id: string }) => {
          if (id !== thread.id) throw new Error(`Requested entity was not found: ${id}`);
          return { data: thread };
        },
        list: async ({ q }: { q?: string }) => {
          const sent = q?.match(/^in:sent \(to:(\S+) OR cc:/)?.[1];
          if (sent !== undefined) return { data: { threads: sentTo.includes(sent) ? [{ id: "sent-1" }] : [] } };
          return { data: { threads: [{ id: thread.id }] } };
        },
      },
      drafts: {
        create: async ({ requestBody }: { requestBody: gmail_v1.Schema$Draft }) => {
          drafts.push(requestBody);
          return { data: { id: `d-${drafts.length}`, message: { id: "dm-1", threadId: requestBody.message?.threadId } } };
        },
      },
    },
  } as unknown as Gmail;
  return { gmail, drafts };
}

export function decodeRaw(raw: string): { headers: string; body: string } {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [headers = "", b64 = ""] = text.split("\r\n\r\n");
  return { headers, body: Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf8") };
}

export const rules = { maxDiscountPercent: 15, banned: ["guarantee", "risk-free"], accounts: [{ name: "Globex", domains: ["globex.example"] }] };

// A full set of server deps over fakes, with a fresh temp data folder (never the user's).

export const tempDataDir = () => join(mkdtempSync(join(tmpdir(), "dh-test-")), "data");

export const fakeSheets = {
  spreadsheets: {
    get: async () => ({ data: { sheets: [{ properties: { title: "Rate card" } }] } }),
    values: { batchGet: async () => ({ data: { valueRanges: [{ range: "'Rate card'!A1:E4", values: simple[0]?.rows }] } }) },
  },
} as unknown as Sheets;

export const fakeDrive = {
  files: {
    get: async ({ fileId, alt }: { fileId: string; alt?: string }) =>
      alt === "media"
        ? { data: "Notes from the Acme call: they need SSO by March." }
        : { data: { id: fileId, name: fileId === "doc-1" ? "Acme notes" : "notes.txt", mimeType: fileId === "doc-1" ? "application/vnd.google-apps.document" : "text/plain" } },
    export: async () => ({ data: "Acme rollout plan. Phase one covers 40 seats." }),
    list: async () => ({ data: { files: [{ id: "doc-1", name: "Acme notes", mimeType: "application/vnd.google-apps.document", modifiedTime: "2026-10-20T00:00:00Z" }] } }),
  },
} as unknown as Drive;

export const fakeCalendar = {
  events: {
    list: async () => ({
      data: {
        items: [
          {
            id: "ev-1",
            summary: "Acme pricing call",
            start: { dateTime: "2026-10-27T10:00:00+08:00" },
            end: { dateTime: "2026-10-27T10:30:00+08:00" },
            attendees: [{ email: "dana@acme.example", displayName: "Dana Lee", responseStatus: "accepted" }],
            description: "Agenda: pricing and rollout timeline.",
          },
        ],
      },
    }),
    get: async () => ({ data: { id: "ev-1", summary: "Acme pricing call", description: "Agenda: pricing and rollout timeline." } }),
  },
} as unknown as Calendar;

export function testDeps(opts: { gmail?: Gmail; dir?: string } = {}): ServerDeps {
  const gmail = opts.gmail ?? fakeGmail().gmail;
  const clients = { gmail: () => gmail, sheets: () => fakeSheets, drive: () => fakeDrive, calendar: () => fakeCalendar };
  return {
    ...clients,
    memory: { dir: opts.dir ?? tempDataDir(), sourceText: sourceReader(clients) },
    loadRateCard: async () => parseRateCard(simple),
    rules: async () => rules,
    loadPipeline: async () => null,
    internalIds: ["RATECARD-SHEET-ID-123"],
  };
}
