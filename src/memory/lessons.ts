// Lessons: patterns the harness noticed, proposed in memory/lessons/proposed.md. Only the user
// accepts them (by moving the line, or with `deal-harness lessons`). Accepted voice lessons go to
// memory/lessons/accepted.md; accepted plays go to company/playbook.md. The harness writes neither.
//
//   - [voice] Never write "I hope this finds you well" · id: L-1a2b3c · status: proposed
//     why: you cut it from 3 drafts before sending (acme.example 2026-10-02, ...) · since 2026-10-26
//
// An accepted "Never write" or "Write ... instead of" lesson adds the phrase to the banned words
// that gmail_draft refuses.

import { createHash } from "node:crypto";
import { normPhrase } from "../learn/diff.js";

export type LessonKind = "voice" | "play";
export type LessonStatus = "proposed" | "rejected";

export interface Lesson {
  kind: LessonKind;
  rule: string;
  id: string;
  status: LessonStatus;
  why: string;
  since: string;
}

export const PROPOSED = "memory/lessons/proposed.md";
export const ACCEPTED = "memory/lessons/accepted.md";
export const PLAYBOOK = "company/playbook.md";

export const lessonId = (kind: LessonKind, rule: string) => `L-${createHash("sha1").update(`${kind}:${normPhrase(rule)}`).digest("hex").slice(0, 6)}`;

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/·/g, "-").trim();

export function formatLesson(l: Lesson): string {
  return `- [${l.kind}] ${clean(l.rule)} · id: ${l.id} · status: ${l.status}\n  why: ${clean(l.why)} · since ${l.since}`;
}

const HEAD = /^- \[(voice|play)\] (.+?) · id: (L-[0-9a-f]+)(?: · status: (proposed|rejected))?\s*$/;
const TAIL = /^\s+why: (.*?)(?: · since (\d{4}-\d{2}-\d{2}))?\s*$/;

export function parseLessons(md: string): Lesson[] {
  const lines = md.split("\n");
  const out: Lesson[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = (lines[i] ?? "").match(HEAD);
    if (!h) continue;
    const t = (lines[i + 1] ?? "").match(TAIL);
    out.push({ kind: h[1] as LessonKind, rule: h[2] ?? "", id: h[3] ?? "", status: (h[4] as LessonStatus | undefined) ?? "proposed", why: t?.[1] ?? "", since: t?.[2] ?? "" });
    if (t) i++;
  }
  return out;
}

// Ids and rules already known in any of the files, so nothing is proposed twice
// (a rejected lesson stays in proposed.md as rejected and is never proposed again).
export function knownLessons(...mds: string[]): { ids: Set<string>; rules: Set<string> } {
  const ids = new Set<string>();
  const rules = new Set<string>();
  for (const md of mds) {
    for (const id of md.matchAll(/\bid: (L-[0-9a-f]+)/g)) ids.add(id[1] ?? "");
    for (const l of parseLessons(md)) rules.add(normPhrase(l.rule));
  }
  return { ids, rules };
}

// Phrases to refuse in drafts, from accepted lessons. Hand-written lines in the same form count too:
//   - Never write "just checking in"      - [voice] Write "Hi Dana" instead of "Dear Dana"
export function bannedFromLessons(acceptedMd: string): string[] {
  const out: string[] = [];
  for (const line of acceptedMd.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const never = line.match(/^\s*[-*]\s+(?:\[voice\]\s+)?never (?:write|say|use) ["“](.+?)["”]/i);
    const instead = line.match(/^\s*[-*]\s+(?:\[voice\]\s+)?(?:write|say|use) ["“].+?["”] instead of ["“](.+?)["”]/i);
    const phrase = never?.[1] ?? instead?.[1];
    if (phrase?.trim()) out.push(phrase.trim());
  }
  return out;
}

// Remove one lesson (its two lines) from a file.
export function removeLesson(md: string, l: Lesson): string {
  const lines = md.split("\n");
  const i = lines.findIndex((x) => x.match(HEAD)?.[3] === l.id);
  if (i < 0) return md;
  const n = TAIL.test(lines[i + 1] ?? "") ? 2 : 1;
  lines.splice(i, n);
  return lines.join("\n");
}

export function setStatus(md: string, l: Lesson, status: LessonStatus): string {
  return md
    .split("\n")
    .map((x) => (x.match(HEAD)?.[3] === l.id ? `- [${l.kind}] ${clean(l.rule)} · id: ${l.id} · status: ${status}` : x))
    .join("\n");
}

// How an accepted lesson reads in accepted.md or the playbook: the rule and its evidence, no status.
export function acceptedLine(l: Lesson, today: string): string {
  return `- [${l.kind}] ${clean(l.rule)} · id: ${l.id}\n  why: ${clean(l.why)} · accepted ${today}`;
}
