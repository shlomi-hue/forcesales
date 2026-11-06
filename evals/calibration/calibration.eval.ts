// Calibration and forecast numbers against values worked out by hand.
//
// calibration_score on a data folder with logged probabilities must give the hand-computed Brier
// score, base-rate Brier and bucket counts, using only the last probability logged on or before
// each confirmed close. forecast and scenario_model must give the hand-computed totals and deltas.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { forecast, parsePeriod, scenario, type ForecastDeal } from "../../src/forecast/model.js";
import { formatProbability } from "../../src/memory/probabilities.js";
import { calibrationScore } from "../../src/tools/forecast.js";
import { tempDataDir } from "../../test/tools/fake-google.js";
import { writeHistory } from "../lib/history.js";
import { record } from "../lib/score.js";

interface Fixture {
  deals: { account: string; outcome: "won" | "lost"; closed: string; confirmed?: boolean; log: [string, number][] }[];
  expect: { scored: number; brier: string; baselineBrier: string; buckets: Record<string, number> };
  pipeline: {
    period: string;
    deals: ForecastDeal[];
    totals: Record<string, Record<string, number>>;
    whatIfs: { name: string; changes: { account: string; probability?: number; close?: string; status?: "won" | "lost" }[]; delta: Record<string, Record<string, number>> }[];
  };
}

const fx = JSON.parse(readFileSync(join("evals", "calibration", "hand-checked.json"), "utf8")) as Fixture;
const failures: string[] = [];
const checks = { run: 0, passed: 0 };
const metrics: Record<string, string | number> = {};
const check = (ok: boolean, what: string) => {
  checks.run++;
  if (ok) checks.passed++;
  else failures.push(what);
  return ok;
};

describe("calibration", () => {
  it("scores logged probabilities exactly as worked out by hand", async () => {
    const dir = tempDataDir();
    await writeHistory(dir, fx.deals.map((d) => ({ account: d.account, industry: "logistics", size: "mid", closed: d.closed, outcome: d.outcome, confirmed: d.confirmed ?? true })));
    for (const d of fx.deals) {
      mkdirSync(join(dir, "memory", "deals", d.account), { recursive: true });
      const lines = d.log.map(([date, pct]) => formatProbability({ date, p: pct / 100, why: "eval" }));
      writeFileSync(join(dir, "memory", "deals", d.account, "probabilities.md"), `# Win probability\n\n${lines.join("\n")}\n`);
    }
    const md = await calibrationScore({ dir, sourceText: async () => null });
    const live = md.split("## ").find((s) => s.startsWith("The harness's own forecasts")) ?? "";
    const num = (label: string) => live.match(new RegExp(`- ${label}: ([\\d.]+)`))?.[1];
    metrics["Brier (hand: " + fx.expect.brier + ")"] = num("Brier score") ?? "-";
    check(num("deals scored") === String(fx.expect.scored), `deals scored: expected ${fx.expect.scored}, got ${num("deals scored")}`);
    check(num("Brier score") === fx.expect.brier, `Brier: expected ${fx.expect.brier}, got ${num("Brier score")}`);
    check(num("Brier score of always guessing the base rate") === fx.expect.baselineBrier, `base-rate Brier: expected ${fx.expect.baselineBrier}, got ${num("Brier score of always guessing the base rate")}`);
    for (const [range, n] of Object.entries(fx.expect.buckets)) {
      const row = live.split("\n").find((l) => l.startsWith(`| ${range} |`));
      check(row?.split("|")[2]?.trim() === String(n), `bucket ${range}: expected ${n} deals, got ${row ?? "no row"}`);
    }
    expect(failures).toEqual([]);
  });

  it("forecast totals match the hand count", () => {
    const f = forecast(fx.pipeline.deals, parsePeriod(fx.pipeline.period, "2026-10-26"));
    for (const [cur, want] of Object.entries(fx.pipeline.totals)) {
      const got = f.totals[cur] ?? {};
      check(JSON.stringify(got) === JSON.stringify(want), `forecast ${cur}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
    }
    expect(f.totals).toEqual(fx.pipeline.totals);
  });

  for (const w of fx.pipeline.whatIfs) {
    it(`what-if "${w.name}" moves the quarter by the hand-computed amount`, () => {
      const r = scenario(fx.pipeline.deals, parsePeriod(fx.pipeline.period, "2026-10-26"), w.changes);
      const got = Object.fromEntries(Object.keys(w.delta).map((c) => [c, r.delta[c]]));
      check(JSON.stringify(got) === JSON.stringify(w.delta), `what-if ${w.name}: expected ${JSON.stringify(w.delta)}, got ${JSON.stringify(got)}`);
      expect(got).toEqual(w.delta);
    });
  }

  afterAll(() => {
    record({
      set: "calibration",
      about: `${fx.deals.length} deals with logged probabilities (one unconfirmed, two with entries after the close), a ${fx.pipeline.deals.length}-deal pipeline and ${fx.pipeline.whatIfs.length} what-ifs, all checked against numbers worked out by hand.`,
      cases: checks.run,
      passed: checks.passed,
      metrics,
      failures,
    });
  });
});
