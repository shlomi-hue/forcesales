// Promises made on a deal, by the user ("us") or the buyer ("them"), with the quote that proves it.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { safePath } from "../data/folder.js";
import { daysBetween, formatPromise, parsePromises, type ParsedPromise } from "../memory/promises.js";
import { accountSlug, memoryWrite, type MemoryDeps, type WriteResult } from "./memory.js";

const today = () => new Date().toISOString().slice(0, 10);
const fileFor = (account: string) => `memory/deals/${accountSlug(account)}/promises.md`;

export interface NewPromise {
  account: string;
  owner: "us" | "them";
  who: string;
  what: string;
  due: string;
  quote: string;
  source: string;
}

export async function logPromise(deps: MemoryDeps, p: NewPromise): Promise<WriteResult> {
  const rel = fileFor(p.account);
  const { abs } = safePath(deps.dir, rel, { write: true });
  const header = existsSync(abs) ? "" : `# Promises · ${p.account}\n\n`;
  const line = formatPromise({ done: false, due: p.due, owner: p.owner, who: p.who.replace(/:/g, ""), what: p.what, quote: p.quote.replace(/^["“]|["”]$/g, ""), source: p.source, logged: today() });
  return memoryWrite(deps, { path: rel, content: `${header}${line}\n`, mode: "append" }, `Promise for ${p.account}: ${p.who} will ${p.what}`);
}

// Tick off the one open promise whose text matches.
export async function completePromise(deps: MemoryDeps, account: string, match: string): Promise<string> {
  const rel = fileFor(account);
  const { abs } = safePath(deps.dir, rel);
  if (!existsSync(abs)) return `No promises logged for ${account}.`;
  const md = readFileSync(abs, "utf8");
  const needle = match.toLowerCase();
  const hits = parsePromises(md).promises.filter((p) => !p.done && `${p.who}: ${p.what}`.toLowerCase().includes(needle));
  if (hits.length === 0) return `No open promise for ${account} matches "${match}".`;
  if (hits.length > 1) return `Several open promises match "${match}":\n${hits.map((h) => `- ${h.who}: ${h.what}`).join("\n")}\nBe more specific.`;
  const hit = hits[0] as ParsedPromise;
  const next = md.replace(hit.text, formatPromise({ ...hit, done: true, doneOn: today() }));
  await memoryWrite(deps, { path: rel, content: next, mode: "replace" }, `Promise kept for ${account}: ${hit.what}`);
  return `Marked done: ${hit.who}: ${hit.what}.`;
}

export interface DuePromise extends ParsedPromise {
  account: string;
  daysLate: number;
}

// Open promises across all deals: late ones, and ones due in the next `ahead` days.
export function promisesDue(dir: string, asOf: string = today(), ahead = 2): { late: DuePromise[]; soon: DuePromise[] } {
  const deals = join(dir, "memory", "deals");
  const late: DuePromise[] = [];
  const soon: DuePromise[] = [];
  if (!existsSync(deals)) return { late, soon };
  for (const account of readdirSync(deals)) {
    const file = join(deals, account, "promises.md");
    if (!existsSync(file)) continue;
    for (const p of parsePromises(readFileSync(file, "utf8")).promises) {
      if (p.done) continue;
      const daysLate = daysBetween(p.due, asOf);
      if (daysLate > 0) late.push({ ...p, account, daysLate });
      else if (-daysLate <= ahead) soon.push({ ...p, account, daysLate });
    }
  }
  late.sort((a, b) => b.daysLate - a.daysLate);
  soon.sort((a, b) => a.due.localeCompare(b.due));
  return { late, soon };
}

export function formatDue(d: { late: DuePromise[]; soon: DuePromise[] }): string {
  const row = (p: DuePromise) =>
    `- ${p.account} · ${p.owner === "us" ? "you owe" : "they owe"} · ${p.who}: ${p.what} · due ${p.due}${p.daysLate > 0 ? ` (${p.daysLate} day${p.daysLate === 1 ? "" : "s"} late)` : ""} · source: ${p.source}`;
  const parts: string[] = [];
  parts.push(d.late.length ? `Late:\n${d.late.map(row).join("\n")}` : "Late: none.");
  parts.push(d.soon.length ? `Due soon:\n${d.soon.map(row).join("\n")}` : "Due soon: none.");
  return parts.join("\n\n");
}
