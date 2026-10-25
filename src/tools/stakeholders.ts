// What one stakeholder has said and promised, and nothing else. /prep's committee rehearsal
// plays each person from this view only, so no one "knows" what a colleague said in private.

import { existsSync, readFileSync } from "node:fs";
import { safePath } from "../data/folder.js";
import { parsePromises } from "../memory/promises.js";
import { parseSignals } from "../memory/signals.js";
import { dataBlock } from "../server/data-block.js";
import { accountSlug, type MemoryDeps } from "./memory.js";

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function stakeholderView(deps: MemoryDeps, account: string, person: string): string {
  const slug = accountSlug(account);
  const acct = safePath(deps.dir, `memory/accounts/${slug}.md`).abs;
  if (!existsSync(acct)) return `No account file for ${account}. Run /account first.`;
  const md = readFileSync(acct, "utf8");

  const people = md.split(/^## /m).find((s) => /^people\b/i.test(s)) ?? "";
  const first = person.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const role = people
    .split("\n")
    .filter((l) => /^\s*[-*]\s/.test(l) && l.toLowerCase().includes(person.trim().toLowerCase()))
    .map((l) => l.replace(/^\s*[-*]\s+/, "").replace(/\S+@\S+/g, "").replace(/\s*·\s*·/g, " ·").trim());

  const signals = parseSignals(md).signals.filter((s) => sameName(s.who, person));
  const promisesFile = safePath(deps.dir, `memory/deals/${slug}/promises.md`).abs;
  const promises = existsSync(promisesFile) ? parsePromises(readFileSync(promisesFile, "utf8")).promises.filter((p) => sameName(p.who, person)) : [];

  if (role.length === 0 && signals.length === 0) {
    const hint = first ? ` Check the People section spelling (looked for "${person}").` : "";
    return `Nothing on file for ${person} at ${account}.${hint}`;
  }
  const lines = [
    `person: ${person}`,
    `account: ${account}`,
    `role: ${role.join(" / ") || "unknown"}`,
    "",
    "their own words:",
    ...(signals.length ? signals.map((s) => `- [${s.type}] "${s.quote}" (${s.date})`) : ["- none on file"]),
    "",
    "their promises:",
    ...(promises.length ? promises.map((p) => `- ${p.done ? "kept" : "open"}: ${p.what}, due ${p.due}`) : ["- none on file"]),
  ];
  return dataBlock(`memory/stakeholder/${slug}`, lines.join("\n"));
}
