// What the user changed in harness drafts before sending them.
//
// memory/edits/pending.json (git-ignored): drafts the harness made that haven't been sent yet,
// with the text as the harness wrote it. Kept out of git: it's whole drafts, not derived facts.
//
// memory/edits/<YYYY-MM>.md: one section per sent draft, only the changed words:
//   ## 2026-10-26 · draft r-123 · acme.example · Re: Pricing
//   - sent: 2026-10-27 · words: 120 → 98
//   - cut: "I hope this finds you well."
//   - changed: "Let me know if you have any questions." → "Can you confirm by Friday?"
//   - added: "Thanks, Shlomi"
//   - rewrote: 40 words → 35 words

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { wordCount, wordDiff } from "../learn/diff.js";

export const PENDING = "memory/edits/pending.json";

export interface PendingDraft {
  draftId: string;
  threadId: string | null;
  to: string[];
  subject: string;
  body: string;
  created: string; // ISO time
}

export function readPending(dir: string): PendingDraft[] {
  const f = join(dir, PENDING);
  if (!existsSync(f)) return [];
  try {
    const v = JSON.parse(readFileSync(f, "utf8")) as unknown;
    return Array.isArray(v) ? (v as PendingDraft[]) : [];
  } catch {
    return [];
  }
}

export function writePending(dir: string, drafts: PendingDraft[]): void {
  const f = join(dir, PENDING);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, `${JSON.stringify(drafts, null, 2)}\n`);
}

export function addPending(dir: string, d: PendingDraft): void {
  writePending(dir, [...readPending(dir).filter((x) => x.draftId !== d.draftId), d]);
}

// Hunks longer than this are rewrites: recorded as a word count, never learned from.
export const MAX_SNIPPET_WORDS = 12;

const flat = (s: string) => s.replace(/\s+/g, " ").replace(/"/g, "'").trim();

export interface EditRecord {
  date: string;
  draftId: string;
  account: string;
  subject: string;
  sent: string;
  cuts: string[];
  changes: [string, string][];
  adds: string[];
  rewrites: number;
  unchanged: boolean;
}

export function compareDraft(draft: string, sent: string): Omit<EditRecord, "date" | "draftId" | "account" | "subject" | "sent"> & { before: number; after: number } {
  const hunks = wordDiff(draft, sent);
  const r = { cuts: [] as string[], changes: [] as [string, string][], adds: [] as string[], rewrites: 0, unchanged: hunks.length === 0, before: wordCount(draft), after: wordCount(sent) };
  for (const h of hunks) {
    const long = wordCount(h.removed) > MAX_SNIPPET_WORDS || wordCount(h.added) > MAX_SNIPPET_WORDS;
    if (long) r.rewrites++;
    else if (h.removed && h.added) r.changes.push([flat(h.removed), flat(h.added)]);
    else if (h.removed) r.cuts.push(flat(h.removed));
    else r.adds.push(flat(h.added));
  }
  return r;
}

export function formatEdit(e: { date: string; draftId: string; account: string; subject: string; sent: string; before: number; after: number } & ReturnType<typeof compareDraft>): string {
  const lines = [
    `## ${e.date} · draft ${e.draftId} · ${e.account} · ${flat(e.subject).replace(/·/g, "-") || "(no subject)"}`,
    `- sent: ${e.sent} · words: ${e.before} → ${e.after}${e.unchanged ? " · unchanged" : ""}`,
    ...e.cuts.map((c) => `- cut: "${c}"`),
    ...e.changes.map(([a, b]) => `- changed: "${a}" → "${b}"`),
    ...e.adds.map((a) => `- added: "${a}"`),
  ];
  if (e.rewrites) lines.push(`- rewrote: ${e.rewrites} longer passage(s)`);
  return `${lines.join("\n")}\n`;
}

export function parseEdits(md: string): EditRecord[] {
  const out: EditRecord[] = [];
  for (const section of md.split(/^(?=## )/m)) {
    const h = section.match(/^## (\d{4}-\d{2}-\d{2}) · draft (\S+) · ([^·\n]+?) · (.*)$/m);
    if (!h) continue;
    const e: EditRecord = { date: h[1] ?? "", draftId: h[2] ?? "", account: h[3] ?? "", subject: h[4] ?? "", sent: "", cuts: [], changes: [], adds: [], rewrites: 0, unchanged: false };
    for (const line of section.split("\n")) {
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^- sent: (\S+)(.*)$/))) {
        e.sent = m[1] ?? "";
        e.unchanged = /· unchanged/.test(m[2] ?? "");
      } else if ((m = line.match(/^- cut: "(.*)"$/))) e.cuts.push(m[1] ?? "");
      else if ((m = line.match(/^- changed: "(.*)" → "(.*)"$/))) e.changes.push([m[1] ?? "", m[2] ?? ""]);
      else if ((m = line.match(/^- added: "(.*)"$/))) e.adds.push(m[1] ?? "");
      else if ((m = line.match(/^- rewrote: (\d+)/))) e.rewrites = Number(m[1]);
    }
    out.push(e);
  }
  return out;
}

export function readEdits(dir: string): EditRecord[] {
  const d = join(dir, "memory", "edits");
  if (!existsSync(d)) return [];
  return readdirSync(d)
    .filter((f) => /^\d{4}-\d{2}\.md$/.test(f))
    .sort()
    .flatMap((f) => parseEdits(readFileSync(join(d, f), "utf8")));
}
