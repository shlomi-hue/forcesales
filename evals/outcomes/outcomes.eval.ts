// Outcome replay: past deals replayed in the order they closed.
//
// In code, every run: each deal is predicted from the base rate of only the deals confirmed
// before it (no peeking at later outcomes), and scored against how it really ended (Brier score),
// next to the plain win rate so far. Plus: the ICP map matches a count by hand, an unconfirmed
// outcome changes nothing, and outcome_log refuses evidence that isn't in its source.
// With EVAL_AGENT=1: Claude Code reads closing threads and logs each outcome; scored on whether it
// got won / lost / no-decision / open right, and whether it left every one unconfirmed.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { calibrate, prior } from "../../src/forecast/model.js";
import { joinDeals, type Deal } from "../../src/history/stats.js";
import { parseHistory } from "../../src/memory/history.js";
import { parseOutcomes } from "../../src/memory/outcomes.js";
import { historyStats, loadDeals, logOutcome } from "../../src/tools/history.js";
import { tempDataDir } from "../../test/tools/fake-google.js";
import { agentSkip, runAgent } from "../lib/agent.js";
import { fixtureDeps, toThread, type FixtureMessage } from "../lib/fixtures.js";
import { writeHistory, type PastDealRow } from "../lib/history.js";
import { ratio, record } from "../lib/score.js";

const fixture = JSON.parse(readFileSync(join("evals", "outcomes", "past-deals.json"), "utf8")) as { deals: PastDealRow[]; icp: Record<string, string> };
const CLOSING = join("evals", "outcomes", "closing");
const closing = readdirSync(CLOSING)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => ({ id: f.replace(/\.json$/, ""), ...(JSON.parse(readFileSync(join(CLOSING, f), "utf8")) as { company: string; domain: string; outcome: string; messages: FixtureMessage[] }) }));

const failures: string[] = [];
const checks = { run: 0, passed: 0 };
const metrics: Record<string, string | number> = {};
const agent = { runs: 0, ran: 0, right: 0, unconfirmed: 0 };
const skip = agentSkip();
const check = (ok: boolean, what: string) => {
  checks.run++;
  if (ok) checks.passed++;
  else failures.push(what);
  return ok;
};

const asDeals = (rows: PastDealRow[]): Deal[] =>
  joinDeals(
    rows.map((r) => parseHistory(r.account, `# ${r.account}\nindustry: ${r.industry}\nsize: ${r.size}\n`)),
    rows.map((r) => ({ account: r.account, outcome: r.outcome, confirmed: r.confirmed, closed: r.closed, evidence: "x", source: "x" })),
  );

describe("outcomes", () => {
  it("replays past deals in close order: base rates beat the plain win rate", () => {
    const rows = fixture.deals.filter((d) => d.confirmed).sort((a, b) => a.closed.localeCompare(b.closed));
    const pairs: { p: number; y: number }[] = [];
    const plain: { p: number; y: number }[] = [];
    for (const [i, d] of rows.entries()) {
      const before = asDeals(rows.slice(0, i));
      const p = prior({ industry: d.industry, size: d.size, account: d.account }, before);
      if (!p) continue;
      const y = d.outcome === "won" ? 1 : 0;
      pairs.push({ p: p.p, y });
      plain.push({ p: p.overall, y });
    }
    const seg = calibrate(pairs);
    const base = calibrate(plain);
    metrics["deals replayed"] = seg.n;
    metrics["replay Brier (base rates)"] = Number((seg.brier ?? 0).toFixed(3));
    metrics["replay Brier (plain win rate so far)"] = Number((base.brier ?? 0).toFixed(3));
    expect(check((seg.brier ?? 1) < (base.brier ?? 0), `replay: segment base rates (${seg.brier}) didn't beat the plain win rate (${base.brier})`)).toBe(true);
  });

  it("builds an ICP map that matches a count by hand, ignoring the unconfirmed deal", async () => {
    const dir = tempDataDir();
    await writeHistory(dir, fixture.deals);
    await historyStats({ dir, sourceText: async () => null });
    const map = readFileSync(join(dir, "company", "icp-map.md"), "utf8");
    const rows = map.split("\n");
    const cell = (label: string) => rows.find((r) => r.startsWith(`| ${label} |`))?.split("|").map((s) => s.trim()).filter(Boolean).at(-1);
    const want: [string, string][] = [
      ["logistics", fixture.icp["logistics, all sizes"] ?? ""],
      ["retail", fixture.icp["retail, all sizes"] ?? ""],
      ["Globex", fixture.icp.Globex ?? ""],
    ];
    for (const [label, expected] of want) check(cell(label) === expected, `ICP map ${label}: expected ${expected}, got ${cell(label)}`);
    expect(want.map(([l]) => cell(l))).toEqual(want.map(([, e]) => e));
  });

  it("an unconfirmed outcome doesn't move any base rate", async () => {
    const dir = tempDataDir();
    const confirmed = fixture.deals.filter((d) => d.confirmed);
    await writeHistory(dir, confirmed);
    const without = prior({ industry: "logistics", size: "mid" }, loadDeals(dir))?.p;
    await writeHistory(dir, fixture.deals);
    const withIt = prior({ industry: "logistics", size: "mid" }, loadDeals(dir))?.p;
    expect(check(without !== undefined && without === withIt, `unconfirmed a25 moved the logistics/mid base rate (${without} → ${withIt})`)).toBe(true);
  });

  it("outcome_log refuses evidence that isn't in the source", async () => {
    const src = "Thanks for all the work on this. After a long review we've decided to go with Globex, mainly on price.";
    const deps = { dir: tempDataDir(), sourceText: async (s: string) => (s === "gmail/thread/t" ? src : null) };
    const bad = await logOutcome(deps, { account: "wayne", outcome: "lost", evidence: "we picked Globex because you were too expensive", source: "gmail/thread/t" });
    const good = await logOutcome(deps, { account: "wayne", outcome: "lost", evidence: "we've decided to go with Globex", source: "gmail/thread/t" });
    const lines = parseOutcomes(readFileSync(join(deps.dir, "memory/history/outcomes.md"), "utf8"));
    expect(check(/^Not logged/.test(bad) && /not confirmed/.test(good) && lines.length === 1 && !lines[0]?.confirmed, "outcome_log accepted made-up evidence or confirmed an outcome")).toBe(true);
  });

  for (const c of closing) {
    it.skipIf(skip !== null)(`agent: logs ${c.id} as ${c.outcome}, unconfirmed`, async () => {
      const tid = `t-${c.id}`;
      const { deps } = fixtureDeps(toThread(tid, c.messages), { sentTo: [c.domain] });
      agent.runs++;
      const run = await runAgent(
        deps,
        `This is an unattended run: don't ask questions. Read Gmail thread ${tid} with gmail_read. It is the last thread of a deal with ${c.company} (domain ${c.domain}). Decide how the deal stands (won, lost, no-decision, or open) and record it with outcome_log for account "${c.domain.split(".")[0]}", with the exact words that show it as evidence.`,
      );
      const file = join(deps.memory.dir, "memory/history/outcomes.md");
      const lines = existsSync(file) ? parseOutcomes(readFileSync(file, "utf8")) : [];
      if (!run.ok || lines.length === 0) {
        failures.push(`${c.id}: agent logged no outcome: ${run.out.slice(-300)}`);
        expect.fail("no outcome");
      }
      agent.ran++;
      const o = lines[0];
      if (o?.outcome === c.outcome) agent.right++;
      else failures.push(`${c.id}: agent logged ${o?.outcome}, expected ${c.outcome}`);
      if (lines.every((l) => !l.confirmed)) agent.unconfirmed++;
      else failures.push(`${c.id}: an outcome was saved as confirmed`);
    });
  }

  afterAll(() => {
    record({
      set: "outcomes",
      about: `${fixture.deals.length} past deals replayed in close order (one unconfirmed). ${agent.ran ? `Agent: Claude Code judged ${agent.ran} closing threads.` : "The agent part didn't run."}`,
      cases: checks.run + agent.runs,
      passed: checks.passed + agent.right,
      metrics: {
        ...metrics,
        ...(agent.ran ? { "agent outcome right": ratio(agent.right, agent.ran), "left unconfirmed": ratio(agent.unconfirmed, agent.ran) } : {}),
      },
      failures,
      ...(skip ? { skipped: skip } : {}),
    });
  });
});
