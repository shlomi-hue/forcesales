// The learning loop: remember each draft, pair it with what the user actually sent, record the
// changed words, and propose lessons from repeated edits and confirmed outcomes. Proposals wait in
// memory/lessons/proposed.md for the user; nothing here changes a rule.

import type { gmail_v1 } from "@googleapis/gmail";
import { localToday } from "../dates.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { companyDomain, addressesIn } from "../checks/addresses.js";
import { ensureDataFolder } from "../data/folder.js";
import { playLessons, voiceLessons } from "../learn/learn.js";
import { addPending, compareDraft, formatEdit, readEdits, readPending, writePending, type PendingDraft } from "../memory/edits.js";
import { formatLesson, knownLessons, lessonId, parseLessons, ACCEPTED, PLAYBOOK, PROPOSED, type Lesson, type LessonKind } from "../memory/lessons.js";
import { normPhrase } from "../learn/diff.js";
import { bodyText, type Gmail } from "./gmail.js";
import { loadDeals } from "./history.js";
import { memoryWrite, type MemoryDeps } from "./memory.js";
import { ownWords } from "./scan.js";

const read = (dir: string, rel: string) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), "utf8") : "");

// Drafts still unsent after this long are dropped from the pending list.
const KEEP_DAYS = 30;

export async function recordDraft(dir: string, d: PendingDraft): Promise<void> {
  await ensureDataFolder(dir);
  addPending(dir, d);
}

const notFound = (err: unknown) => {
  const e = err as { code?: number; status?: number; message?: string };
  return e.code === 404 || e.status === 404 || /not found/i.test(e.message ?? "");
};

const accountOf = (to: string[]) => to.flatMap(addressesIn).map(companyDomain).find((d): d is string => !!d) ?? "unknown";

export interface CaptureResult {
  paired: number;
  unchanged: number;
  waiting: number;
  discarded: number;
  expired: number;
  files: string[];
}

// For each draft the harness made: still a draft → wait; sent → record what changed; gone → discarded.
export async function captureSent(gmail: Gmail, deps: MemoryDeps, now: Date = new Date()): Promise<CaptureResult> {
  await ensureDataFolder(deps.dir);
  const pending = readPending(deps.dir);
  const keep: PendingDraft[] = [];
  const r: CaptureResult = { paired: 0, unchanged: 0, waiting: 0, discarded: 0, expired: 0, files: [] };
  const sections = new Map<string, string[]>();
  for (const p of pending) {
    const stillDraft = await gmail.users.drafts.get({ userId: "me", id: p.draftId, format: "minimal" }).then(
      () => true,
      (err: unknown) => {
        if (notFound(err)) return false;
        throw err;
      },
    );
    const age = (now.getTime() - Date.parse(p.created)) / 86_400_000;
    if (stillDraft) {
      if (age > KEEP_DAYS) r.expired++;
      else {
        keep.push(p);
        r.waiting++;
      }
      continue;
    }
    const sent = p.threadId ? await firstSentAfter(gmail, p.threadId, Date.parse(p.created)) : null;
    if (!sent) {
      r.discarded++;
      continue;
    }
    const cmp = compareDraft(p.body, ownWords(bodyText(sent.payload)));
    const sentDay = localToday(new Date(Number(sent.internalDate ?? now.getTime())));
    const month = sentDay.slice(0, 7);
    const md = formatEdit({ date: localToday(new Date(p.created)), draftId: p.draftId, account: accountOf(p.to), subject: p.subject, sent: sentDay, ...cmp });
    sections.set(month, [...(sections.get(month) ?? []), md]);
    r.paired++;
    if (cmp.unchanged) r.unchanged++;
  }
  for (const [month, mds] of sections) {
    const rel = `memory/edits/${month}.md`;
    const head = existsSync(join(deps.dir, rel)) ? "" : `# Edits to drafts, ${month}\n\nWhat you changed in harness drafts before sending them. Written by edits_capture.\n\n`;
    await memoryWrite(deps, { path: rel, content: `${head}${mds.join("\n")}`, mode: "append" }, `Capture ${mds.length} sent draft(s)`, true);
    r.files.push(rel);
  }
  writePending(deps.dir, keep);
  return r;
}


async function firstSentAfter(gmail: Gmail, threadId: string, afterMs: number): Promise<gmail_v1.Schema$Message | null> {
  let messages: gmail_v1.Schema$Message[];
  try {
    messages = (await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" })).data.messages ?? [];
  } catch (err) {
    if (notFound(err)) return null;
    throw err;
  }
  const sent = messages
    .filter((m) => (m.labelIds ?? []).includes("SENT") && !(m.labelIds ?? []).includes("DRAFT") && Number(m.internalDate ?? 0) >= afterMs - 60_000)
    .sort((a, b) => Number(a.internalDate ?? 0) - Number(b.internalDate ?? 0));
  return sent[0] ?? null;
}

export function formatCapture(r: CaptureResult): string {
  const lines = [
    `Paired ${r.paired} sent draft(s) with what the harness wrote${r.paired ? ` (${r.unchanged} sent unchanged)` : ""}.`,
    `${r.waiting} draft(s) still waiting in Gmail Drafts.`,
  ];
  if (r.discarded) lines.push(`${r.discarded} draft(s) were deleted without sending.`);
  if (r.expired) lines.push(`${r.expired} draft(s) older than ${KEEP_DAYS} days dropped from tracking.`);
  if (r.files.length) lines.push(`Changes saved in ${r.files.join(", ")}.`);
  return lines.join("\n");
}

const PROPOSED_HEADER = `# Proposed lessons

Patterns the harness noticed. Nothing here is used until you accept it.
Accept or reject each with \`deal-harness lessons\`, or by hand: move a line to accepted.md (voice) or
company/playbook.md (plays) to accept it, or change "status: proposed" to "status: rejected".
A rejected lesson is never proposed again.
`;

async function addLessons(deps: MemoryDeps, candidates: Lesson[], message: string): Promise<Lesson[]> {
  const proposed = read(deps.dir, PROPOSED);
  const known = knownLessons(proposed, read(deps.dir, ACCEPTED), read(deps.dir, PLAYBOOK));
  const fresh = candidates.filter((l) => !known.ids.has(l.id) && !known.rules.has(normPhrase(l.rule)));
  const unique = fresh.filter((l, i) => fresh.findIndex((x) => x.id === l.id) === i);
  if (unique.length === 0) return [];
  const base = proposed.trim() ? proposed : PROPOSED_HEADER;
  await memoryWrite(deps, { path: PROPOSED, content: `${base.replace(/\n*$/, "\n")}\n${unique.map(formatLesson).join("\n")}\n`, mode: "replace" }, message, true);
  return unique;
}

// Run the counts over all recorded edits and confirmed outcomes, and propose what's new.
export async function learnLessons(deps: MemoryDeps, today = localToday()): Promise<string> {
  await ensureDataFolder(deps.dir);
  const edits = readEdits(deps.dir);
  const deals = loadDeals(deps.dir);
  const added = await addLessons(deps, [...voiceLessons(edits, today), ...playLessons(deals, today)], "Propose lessons");
  const open = parseLessons(read(deps.dir, PROPOSED)).filter((l) => l.status === "proposed");
  const lines = [`Looked at ${edits.length} sent draft(s) and ${deals.filter((d) => d.outcome?.confirmed).length} confirmed outcome(s).`];
  lines.push(added.length ? `Proposed ${added.length} new lesson(s):\n${added.map((l) => `- [${l.kind}] ${l.rule} (${l.why})`).join("\n")}` : "Nothing new to propose.");
  if (open.length) lines.push(`${open.length} lesson(s) in ${PROPOSED} wait for the user. They accept or reject them with \`deal-harness lessons\`; the harness can't.`);
  return lines.join("\n");
}

// A lesson the agent noticed itself (say, in /report). It goes in as proposed, like the rest.
export async function proposeLesson(deps: MemoryDeps, l: { kind: LessonKind; rule: string; why: string }, today = localToday()): Promise<string> {
  const lesson: Lesson = { ...l, id: lessonId(l.kind, l.rule), status: "proposed", since: today };
  const added = await addLessons(deps, [lesson], `Propose lesson ${lesson.id}`);
  return added.length
    ? `Proposed ${lesson.id} in ${PROPOSED}. The user accepts or rejects it with \`deal-harness lessons\`.`
    : `Not added: that lesson is already proposed, accepted or rejected.`;
}
