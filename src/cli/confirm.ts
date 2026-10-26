// `deal-harness confirm`: the user goes through unconfirmed outcomes in the terminal.
// This is the only way besides editing the file by hand: the agent has no tool that confirms.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { commit, dataDir } from "../data/folder.js";
import { formatOutcome, parseOutcomes, type Outcome, type OutcomeLine } from "../memory/outcomes.js";

// y confirms; w/l/n set the outcome and confirm; d removes the line; anything else changes nothing.
export function applyAnswer(md: string, o: OutcomeLine, answer: string): string {
  const old = formatOutcome(o);
  if (answer === "d") return md.replace(`${old}\n`, "");
  const set: Record<string, Outcome> = { w: "won", l: "lost", n: "no-decision" };
  if (answer !== "y" && !(answer in set)) return md;
  return md.replace(old, formatOutcome({ ...o, outcome: set[answer] ?? o.outcome, confirmed: true }));
}

export async function confirmOutcomes(log: (s: string) => void): Promise<void> {
  const dir = dataDir();
  const file = join(dir, "memory", "history", "outcomes.md");
  if (!existsSync(file)) return log("No outcomes yet. Run /history first.");
  let md = readFileSync(file, "utf8");
  const pending = parseOutcomes(md).filter((o) => !o.confirmed);
  if (pending.length === 0) return log("Every outcome is already confirmed.");

  // Read answers as a stream of lines, so piped answers work as well as typed ones.
  const rl = createInterface({ input: process.stdin, terminal: process.stdin.isTTY === true });
  const answers = rl[Symbol.asyncIterator]();
  log(`${pending.length} outcome(s) to check. y = right, w/l/n = it was won / lost / no decision, d = not a deal (remove), s = skip, q = stop.\n`);
  let changed = 0;
  try {
    for (const o of pending) {
      log(`${o.account}: ${o.outcome}${o.closed ? ` (closed ${o.closed})` : ""}${o.reason ? ` · ${o.reason}` : ""}\n  evidence: "${o.evidence}"\n  source: ${o.source}`);
      process.stderr.write("  [y/w/l/n/d/s/q] ");
      const reply = await answers.next();
      if (reply.done) break;
      const a = String(reply.value).trim().toLowerCase();
      if (a === "q") break;
      if (a === "s" || a === "") continue;
      const next = applyAnswer(md, o, a);
      if (next !== md) changed++;
      md = next;
    }
  } finally {
    rl.close();
  }
  if (!changed) return log("Nothing changed.");
  writeFileSync(file, md);
  await commit(dir, ["memory/history/outcomes.md"], `Confirm ${changed} outcome(s)`);
  log(`Saved ${changed} change(s). Ask the agent to run history_stats to update the ICP map and baseline.`);
}
