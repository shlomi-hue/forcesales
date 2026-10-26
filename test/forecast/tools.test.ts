import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { formatOutcome } from "../../src/memory/outcomes.js";
import { memoryWrite, type MemoryDeps } from "../../src/tools/memory.js";
import { calibrationScore, dealPrior, latestProbability, setProbability } from "../../src/tools/forecast.js";
import { ensureDataFolder } from "../../src/data/folder.js";
import { tempDataDir } from "../tools/fake-google.js";

async function withHistory(): Promise<MemoryDeps> {
  const d: MemoryDeps = { dir: tempDataDir(), sourceText: async () => null };
  await ensureDataFolder(d.dir);
  const h = join(d.dir, "memory", "history");
  mkdirSync(h, { recursive: true });
  const lines: string[] = [];
  const add = (acct: string, industry: string, won: boolean, closed = "2025-06-01") => {
    writeFileSync(join(h, `${acct}.md`), `# ${acct}\nindustry: ${industry}\nsize: 200-1000\n`);
    lines.push(formatOutcome({ account: acct, outcome: won ? "won" : "lost", confirmed: true, closed, evidence: "x", source: "gmail/thread/x" }));
  };
  [1, 2, 3, 4].forEach((i) => add(`l${i}`, "logistics", true));
  add("l5", "logistics", false);
  add("r1", "retail", true);
  [2, 3, 4, 5].forEach((i) => add(`r${i}`, "retail", false));
  writeFileSync(join(h, "outcomes.md"), `# Outcomes\n\n${lines.join("\n")}\n`);
  return d;
}

describe("forecast tools", () => {
  it("gives a base rate from the account's industry and size", async () => {
    const d = await withHistory();
    await memoryWrite(d, { path: "memory/accounts/acme.md", content: "# Acme\nindustry: logistics\nsize: 200-1000\n", mode: "replace" });
    expect(dealPrior(d.dir, "Acme")).toContain("Base rate for Acme: 71% (logistics/200-1000, 5 similar of 10 deals).");
    expect(dealPrior(d.dir, "Unknown Co")).toContain("can't be matched to a segment");
  });

  it("logs probabilities append-only, and they can't be edited by hand", async () => {
    const d = await withHistory();
    await memoryWrite(d, { path: "memory/accounts/acme.md", content: "# Acme\nindustry: logistics\nsize: 200-1000\n", mode: "replace" });
    expect(await setProbability(d, "Acme", 60, "champion strong but CFO unconvinced")).toBe("Logged 60% for Acme (base rate 71%, -11 points).");
    await setProbability(d, "Acme", 65, "CFO agreed to the business case on the call");
    expect(latestProbability(d.dir, "Acme")).toBe(0.65);
    const file = readFileSync(join(d.dir, "memory/deals/acme/probabilities.md"), "utf8");
    expect(file.match(/^- \d{4}/gm)).toHaveLength(2);
    await expect(memoryWrite(d, { path: "memory/deals/acme/probabilities.md", content: "- 2026-01-01 · 99% · why: x", mode: "replace" })).rejects.toThrow(/written only by probability_set/);
  });

  it("scores calibration on confirmed history and on logged forecasts", async () => {
    const d = await withHistory();
    const report = await calibrationScore(d);
    expect(report).toContain("## Backtest on past deals");
    expect(report).toContain("- deals scored: 10");
    expect(report).toContain("The harness's own forecasts (last probability logged before each close)\n\ntoo few (0) to score.");
    expect(readFileSync(join(d.dir, "memory/history/calibration.md"), "utf8")).toBe(report);
  });
});
