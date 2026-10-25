import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daysBetween, formatPromise, parsePromises } from "../../src/memory/promises.js";
import { memoryWrite, type MemoryDeps } from "../../src/tools/memory.js";
import { completePromise, formatDue, logPromise, promisesDue } from "../../src/tools/promises.js";
import { tempDataDir } from "../tools/fake-google.js";

const NOTES = "Suggested next steps\nDana Lee will send the security questionnaire by Friday.\nShlomi will share the SSO case study.";
const deps = (): MemoryDeps => ({ dir: tempDataDir(), sourceText: async (s) => (s === "drive/file/notes-1" ? NOTES : null) });
const base = { account: "Acme", source: "drive/file/notes-1" };

describe("promises", () => {
  it("formats and parses, open and done", () => {
    const p = { done: true, due: "2026-11-03", owner: "them" as const, who: "Dana Lee", what: "send the questionnaire", quote: "will send", source: "gmail/thread/x", logged: "2026-10-28", doneOn: "2026-11-02" };
    expect(parsePromises(formatPromise(p)).promises[0]).toMatchObject(p);
  });

  it("counts days in code", () => {
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
    expect(daysBetween("2026-11-02", "2026-11-02")).toBe(0);
  });

  it("logs a promise only when its quote is in the source", async () => {
    const d = deps();
    const kept = await logPromise(d, { ...base, owner: "them", who: "Dana Lee", what: "send the security questionnaire", due: "2026-10-30", quote: "Dana Lee will send the security questionnaire by Friday" });
    expect(kept).toMatchObject({ path: "memory/deals/acme/promises.md", keptPromises: 1, dropped: [] });
    const dropped = await logPromise(d, { ...base, owner: "them", who: "Dana Lee", what: "sign the contract", due: "2026-10-30", quote: "We will sign next week" });
    expect(dropped.keptPromises).toBe(0);
    expect(dropped.dropped[0]).toContain('promise "sign the contract"');
    const file = readFileSync(join(d.dir, "memory/deals/acme/promises.md"), "utf8");
    expect(file.startsWith("# Promises · Acme\n\n- [ ] 2026-10-30 · them · Dana Lee: send the security questionnaire")).toBe(true);
    expect(file).not.toContain("sign the contract");
  });

  it("refuses promise lines written by hand that don't parse", async () => {
    const d = deps();
    await expect(memoryWrite(d, { path: "memory/deals/acme/promises.md", content: "- [ ] 2026-10-30 · them · no quote line\n", mode: "replace" })).rejects.toThrow(/look like promises/);
  });

  it("lists late and soon promises with days late, and ticks them off", async () => {
    const d = deps();
    await logPromise(d, { ...base, owner: "them", who: "Dana Lee", what: "send the security questionnaire", due: "2026-10-28", quote: "will send the security questionnaire" });
    await logPromise(d, { ...base, owner: "us", who: "Shlomi", what: "share the SSO case study", due: "2026-11-02", quote: "Shlomi will share the SSO case study" });
    const due = promisesDue(d.dir, "2026-11-01", 2);
    expect(due.late.map((p) => [p.what, p.daysLate])).toEqual([["send the security questionnaire", 4]]);
    expect(due.soon.map((p) => p.what)).toEqual(["share the SSO case study"]);
    expect(formatDue(due)).toContain("acme · they owe · Dana Lee: send the security questionnaire · due 2026-10-28 (4 days late)");

    expect(await completePromise(d, "Acme", "questionnaire")).toBe("Marked done: Dana Lee: send the security questionnaire.");
    expect(promisesDue(d.dir, "2026-11-01", 2).late).toEqual([]);
    expect(await completePromise(d, "Acme", "nothing like this")).toContain("No open promise");
  });
});
