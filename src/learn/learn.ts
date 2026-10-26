// Find patterns worth proposing as lessons, from the user's edits to drafts and from confirmed
// outcomes. Pure: counting happens here, in code. Nothing found here is used until the user accepts it.

import type { Deal } from "../history/stats.js";
import type { EditRecord } from "../memory/edits.js";
import { lessonId, type Lesson } from "../memory/lessons.js";
import { normPhrase } from "./diff.js";

// The same edit in this many different drafts, or the same loss reason in this many deals.
export const MIN_REPEATS = 3;

// A cut worth learning from: real words, no numbers (prices and dates are deal-specific),
// and more than one short word ("Hi", "just" alone say little).
function learnable(phrase: string): boolean {
  const p = normPhrase(phrase);
  if (!p || /\d/.test(p) || /@/.test(p) || !/\p{L}/u.test(p)) return false;
  const n = p.split(" ").length;
  return n >= 2 || p.length >= 5;
}

const display = (s: string) => s.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").trim();

const evidence = (rows: { account: string; date: string }[]) => {
  const shown = rows.slice(0, 4).map((r) => `${r.account} ${r.date}`);
  return `${shown.join(", ")}${rows.length > 4 ? `, and ${rows.length - 4} more` : ""}`;
};

export function voiceLessons(edits: EditRecord[], today: string): Lesson[] {
  // phrase -> drafts where it was cut or changed, and what it became
  const seen = new Map<string, { shown: string; drafts: Map<string, { account: string; date: string; to: string | null }> }>();
  for (const e of edits) {
    const cut = [...e.cuts.map((c) => [c, null] as const), ...e.changes.map(([a, b]) => [a, b] as const)];
    for (const [from, to] of cut) {
      if (!learnable(from)) continue;
      const k = normPhrase(from);
      const entry = seen.get(k) ?? { shown: display(from), drafts: new Map() };
      if (!entry.drafts.has(e.draftId)) entry.drafts.set(e.draftId, { account: e.account, date: e.date, to: to === null ? null : display(to) });
      seen.set(k, entry);
    }
  }
  const out: Lesson[] = [];
  for (const [, { shown, drafts }] of seen) {
    if (drafts.size < MIN_REPEATS) continue;
    const rows = [...drafts.values()];
    // The same replacement every time it was changed, at least MIN_REPEATS times: say what to write instead.
    const replacements = new Map<string, number>();
    for (const r of rows) if (r.to) replacements.set(normPhrase(r.to), (replacements.get(normPhrase(r.to)) ?? 0) + 1);
    const [top, n] = [...replacements.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    const insteadOf = n >= MIN_REPEATS ? rows.find((r) => r.to && normPhrase(r.to) === top)?.to : undefined;
    const rule = insteadOf ? `Write "${insteadOf}" instead of "${shown}"` : `Never write "${shown}"`;
    const verb = insteadOf ? "changed it" : "cut or changed it";
    out.push({ kind: "voice", rule, id: lessonId("voice", rule), status: "proposed", why: `you ${verb} in ${drafts.size} drafts before sending (${evidence(rows)})`, since: today });
  }
  return out;
}

const closedLoss = (d: Deal) => d.outcome?.confirmed === true && (d.outcome.outcome === "lost" || d.outcome.outcome === "no-decision");

export function playLessons(deals: Deal[], today: string): Lesson[] {
  const out: Lesson[] = [];
  const byReason = new Map<string, { shown: string; deals: Deal[] }>();
  for (const d of deals.filter(closedLoss)) {
    const r = d.outcome?.reason?.trim();
    if (!r) continue;
    const k = normPhrase(r);
    const entry = byReason.get(k) ?? { shown: display(r), deals: [] };
    entry.deals.push(d);
    byReason.set(k, entry);
  }
  for (const [, { shown, deals: ds }] of byReason) {
    if (ds.length < MIN_REPEATS) continue;
    const rule = `Plan early for "${shown}": it's why ${ds.length} confirmed deals were lost or stalled`;
    out.push({ kind: "play", rule, id: lessonId("play", `reason:${normPhrase(shown)}`), status: "proposed", why: `confirmed outcomes: ${evidence(ds.map((d) => ({ account: d.account, date: d.outcome?.closed ?? "?" })))}`, since: today });
  }
  const byCompetitor = new Map<string, { shown: string; won: number; lost: Deal[] }>();
  for (const d of deals.filter((x) => x.outcome?.confirmed === true && x.outcome.outcome !== "open" && x.competitor)) {
    const k = normPhrase(d.competitor ?? "");
    const entry = byCompetitor.get(k) ?? { shown: d.competitor ?? "", won: 0, lost: [] };
    if (d.outcome?.outcome === "won") entry.won++;
    else entry.lost.push(d);
    byCompetitor.set(k, entry);
  }
  for (const [k, { shown, won, lost }] of byCompetitor) {
    if (lost.length < MIN_REPEATS || lost.length <= won) continue;
    const rule = `Against ${shown}, you lost ${lost.length} of ${lost.length + won} confirmed deals: build the battle card before the first proposal`;
    out.push({ kind: "play", rule, id: lessonId("play", `competitor:${k}`), status: "proposed", why: `confirmed outcomes: ${evidence(lost.map((d) => ({ account: d.account, date: d.outcome?.closed ?? "?" })))}`, since: today });
  }
  return out;
}
