import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyAnswer } from "../../src/cli/confirm.js";
import { formatOutcome, parseOutcomes, upsertOutcome } from "../../src/memory/outcomes.js";
import { memoryWrite, type MemoryDeps } from "../../src/tools/memory.js";
import { logOutcome } from "../../src/tools/history.js";
import { tempDataDir } from "../tools/fake-google.js";

const SRC = "Thanks for your time. After review we've decided to go with Globex this year.";
const deps = (): MemoryDeps => ({ dir: tempDataDir(), sourceText: async (s) => (s === "gmail/thread/t1" ? SRC : null) });
const lost = { account: "acme", outcome: "lost" as const, closed: "2025-09-10", value: 48000, currency: "USD", reason: "chose Globex on price", evidence: "we've decided to go with Globex", source: "gmail/thread/t1" };

describe("outcomes", () => {
  it("formats and parses every field", () => {
    const line = formatOutcome({ ...lost, confirmed: false });
    expect(line).toBe('- [ ] acme · lost · closed 2025-09-10 · 48000 USD · reason: chose Globex on price\n  evidence: "we\'ve decided to go with Globex" · source: gmail/thread/t1');
    expect(parseOutcomes(line)).toEqual([{ ...lost, confirmed: false }]);
  });

  it("keeps a confirmation only when the outcome doesn't change", () => {
    const confirmed = formatOutcome({ ...lost, confirmed: true });
    expect(upsertOutcome(confirmed, { ...lost, reason: "price" })).toMatchObject({ keptConfirmation: true });
    const changed = upsertOutcome(confirmed, { ...lost, outcome: "won" });
    expect(changed.keptConfirmation).toBe(false);
    expect(parseOutcomes(changed.md)[0]).toMatchObject({ outcome: "won", confirmed: false });
  });

  it("logs unconfirmed, only with evidence found in the source", async () => {
    const d = deps();
    expect(await logOutcome(d, { ...lost, evidence: "they loved us" })).toMatch(/^Not logged/);
    expect(await logOutcome(d, lost)).toContain("not confirmed");
    const md = readFileSync(join(d.dir, "memory/history/outcomes.md"), "utf8");
    expect(md).toContain("Tick [x]");
    expect(parseOutcomes(md)).toEqual([{ ...lost, confirmed: false }]);
  });

  it("can't be written or confirmed through memory_write", async () => {
    const d = deps();
    await expect(memoryWrite(d, { path: "memory/history/outcomes.md", content: formatOutcome({ ...lost, confirmed: true }), mode: "replace" })).rejects.toThrow(/written only by outcome_log/);
    await expect(memoryWrite(d, { path: "company/icp-map.md", content: "100% win rate", mode: "replace" })).rejects.toThrow(/written only by history_stats/);
  });

  it("confirm answers: y confirms, w/l/n fix and confirm, d removes, s skips", () => {
    const o = { ...lost, confirmed: false };
    const md = `# Outcomes\n\n${formatOutcome(o)}\n`;
    expect(parseOutcomes(applyAnswer(md, o, "y"))[0]).toMatchObject({ outcome: "lost", confirmed: true });
    expect(parseOutcomes(applyAnswer(md, o, "w"))[0]).toMatchObject({ outcome: "won", confirmed: true });
    expect(parseOutcomes(applyAnswer(md, o, "d"))).toEqual([]);
    expect(applyAnswer(md, o, "s")).toBe(md);
  });
});
