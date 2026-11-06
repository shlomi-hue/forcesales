// Promises: what's late and what's due soon, with days late, against a list worked out by hand.
// Plus: a promise whose quote isn't in its source is dropped, and a kept promise leaves the list.
// (Whether the agent finds promises in a thread is scored in the threads set.)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { formatPromise } from "../../src/memory/promises.js";
import { completePromise, logPromise, promisesDue } from "../../src/tools/promises.js";
import { tempDataDir } from "../../test/tools/fake-google.js";
import { ensureDataFolder } from "../../src/data/folder.js";
import { record } from "../lib/score.js";

interface Fixture {
  asOf: string;
  ahead: number;
  promises: { account: string; done: boolean; due: string; owner: "us" | "them"; who: string; what: string }[];
  late: [string, string, number][];
  soon: [string, string][];
}

const fx = JSON.parse(readFileSync(join("evals", "promises", "due.json"), "utf8")) as Fixture;
const failures: string[] = [];
const checks = { run: 0, passed: 0 };
const check = (ok: boolean, what: string) => {
  checks.run++;
  if (ok) checks.passed++;
  else failures.push(what);
  return ok;
};

async function folder(): Promise<string> {
  const dir = tempDataDir();
  await ensureDataFolder(dir);
  const by = new Map<string, string[]>();
  for (const p of fx.promises) {
    by.set(p.account, [...(by.get(p.account) ?? []), formatPromise({ ...p, quote: "x", source: "gmail/thread/x", logged: "2026-10-01" })]);
  }
  for (const [account, lines] of by) {
    mkdirSync(join(dir, "memory", "deals", account), { recursive: true });
    writeFileSync(join(dir, "memory", "deals", account, "promises.md"), `# Promises · ${account}\n\n${lines.join("\n")}\n`);
  }
  return dir;
}

describe("promises", () => {
  it("lists late promises worst first with the right days late, and the ones due soon", async () => {
    const due = promisesDue(await folder(), fx.asOf, fx.ahead);
    const late = due.late.map((p) => [p.account, p.what, p.daysLate]);
    const soon = due.soon.map((p) => [p.account, p.what]);
    check(JSON.stringify(late) === JSON.stringify(fx.late), `late: expected ${JSON.stringify(fx.late)}, got ${JSON.stringify(late)}`);
    check(JSON.stringify(soon) === JSON.stringify(fx.soon), `due soon: expected ${JSON.stringify(fx.soon)}, got ${JSON.stringify(soon)}`);
    expect(late).toEqual(fx.late);
    expect(soon).toEqual(fx.soon);
  });

  it("a kept promise leaves the list", async () => {
    const dir = await folder();
    await completePromise({ dir, sourceText: async () => null }, "acme", "case study");
    const late = promisesDue(dir, fx.asOf, fx.ahead).late.map((p) => p.what);
    expect(check(!late.includes("send the case study") && late.length === fx.late.length - 1, `kept promise still listed: ${late.join(", ")}`)).toBe(true);
  });

  it("drops a promise whose quote isn't in its source", async () => {
    const deps = { dir: tempDataDir(), sourceText: async () => "Thanks. I'll get you our security questionnaire by Friday 16 October." };
    const base = { account: "initech", owner: "them" as const, who: "Bill", what: "send the questionnaire", due: "2026-10-16", source: "gmail/thread/t" };
    const bad = await logPromise(deps, { ...base, quote: "I'll send the questionnaire this week" });
    const good = await logPromise(deps, { ...base, quote: "I'll get you our security questionnaire by Friday 16 October" });
    expect(check(bad.keptPromises === 0 && bad.dropped.length === 1 && good.keptPromises === 1, "a promise with a made-up quote was kept, or a real one dropped")).toBe(true);
  });

  afterAll(() => {
    record({
      set: "promises",
      about: `${fx.promises.length} promises across 3 deals checked on ${fx.asOf}: late and due-soon lists and days late against a hand count; kept promises drop off; promises with made-up quotes are dropped. The agent finding promises in threads is scored in the threads set.`,
      cases: checks.run,
      passed: checks.passed,
      metrics: { "late listed": `${fx.late.length}`, "due soon listed": `${fx.soon.length}` },
      failures,
    });
  });
});
