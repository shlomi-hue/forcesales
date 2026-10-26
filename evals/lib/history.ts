// Write a set of past deals into a temp data folder: history files and outcomes, as /history leaves them.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ensureDataFolder } from "../../src/data/folder.js";
import { formatOutcome, OUTCOMES_HEADER, type Outcome } from "../../src/memory/outcomes.js";

export interface PastDealRow {
  account: string;
  industry: string;
  size: string;
  closed: string;
  outcome: Outcome;
  confirmed: boolean;
  competitor?: string;
  reason?: string;
}

export async function writeHistory(dir: string, deals: PastDealRow[]): Promise<void> {
  await ensureDataFolder(dir);
  const h = join(dir, "memory", "history");
  mkdirSync(h, { recursive: true });
  for (const d of deals) {
    writeFileSync(join(h, `${d.account}.md`), `# ${d.account}\nindustry: ${d.industry}\nsize: ${d.size}\n${d.competitor ? `competitor: ${d.competitor}\n` : ""}`);
  }
  const lines = deals.map((d) =>
    formatOutcome({ account: d.account, outcome: d.outcome, confirmed: d.confirmed, closed: d.closed, ...(d.reason ? { reason: d.reason } : {}), evidence: "x", source: "gmail/thread/x" }),
  );
  writeFileSync(join(h, "outcomes.md"), `${OUTCOMES_HEADER}\n${lines.join("\n")}\n`);
}
