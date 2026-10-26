import { describe, expect, it } from "vitest";
import { backtest, calibrate, forecast, parsePeriod, prior, scenario, type ForecastDeal } from "../../src/forecast/model.js";
import type { Deal } from "../../src/history/stats.js";

const q4 = parsePeriod("2026-Q4", "2026-10-26");
const deal = (account: string, value: number, close: string, p?: number, extra: Partial<ForecastDeal> = {}): ForecastDeal => ({
  account, value, currency: ["USD"], stage: "proposal", close, status: "open", where: "x", ...(p !== undefined ? { harnessProbability: p } : {}), ...extra,
});
const pipeline: ForecastDeal[] = [
  deal("Acme", 48000, "2026-11-12", 0.4),
  deal("Beta", 20000, "2026-10-02", undefined, { status: "won" }),
  deal("Gamma", 30000, "2026-12-15", 0.7),
  deal("Delta", 10000, "2026-12-20", undefined, { sheetProbability: 0.2 }),
  deal("Echo", 5000, "2026-12-01"),
  deal("Late", 99000, "2027-01-15", 0.9),
  deal("Lost", 7000, "2026-11-01", 0.5, { status: "lost" }),
];

describe("periods", () => {
  it("reads quarters, months, years and defaults to this quarter", () => {
    expect(q4).toEqual({ label: "2026-Q4", from: "2026-10-01", to: "2026-12-31" });
    expect(parsePeriod(undefined, "2026-05-03")).toEqual({ label: "2026-Q2", from: "2026-04-01", to: "2026-06-30" });
    expect(parsePeriod("2026-02", "x")).toEqual({ label: "2026-02", from: "2026-02-01", to: "2026-02-28" });
    expect(() => parsePeriod("next quarter", "2026-10-26")).toThrow();
  });
});

describe("forecast", () => {
  it("sums won, expected, likely and possible, and lists what it can't count", () => {
    const f = forecast(pipeline, q4);
    // won 20000; expected 20000 + 48000*0.4 + 30000*0.7 + 10000*0.2 = 62200; likely 20000 + 30000; possible 20000+48000+30000+10000
    expect(f.totals.USD).toEqual({ won: 20000, expected: 62200, likely: 50000, possible: 108000 });
    expect(f.skipped).toEqual([{ account: "Echo", why: "no probability yet (set one with probability_set)" }]);
  });

  it("moves the quarter by exactly the hand-calculated amount in a what-if", () => {
    // Acme slips to January (-48000*0.4 = -19200) and Gamma drops to 50% (30000*(0.5-0.7) = -6000): -25200 expected.
    // Likely is unchanged: Acme was under 50% and Gamma is still at 50%. Possible loses Acme's 48000.
    const r = scenario(pipeline, q4, [{ account: "Acme", close: "2027-01-10" }, { account: "gamma", probability: 0.5 }, { account: "Nobody", probability: 1 }]);
    expect(r.delta.USD).toEqual({ won: 0, expected: -25200, likely: 0, possible: -48000 });
    expect(r.after.totals.USD?.expected).toBe(37000);
    expect(r.unknown).toEqual(["Nobody"]);
  });

  it("never adds different currencies together", () => {
    const f = forecast([deal("A", 100, "2026-11-01", 1), { ...deal("B", 100, "2026-11-01", 1), currency: ["SGD"] }], q4);
    expect(Object.keys(f.totals).sort()).toEqual(["SGD", "USD"]);
  });
});

const past = (account: string, industry: string, won: boolean, confirmed = true): Deal => ({
  account, name: account, industry, size: "200-1000", worked: [], wentWrong: [],
  outcome: { account, outcome: won ? "won" : "lost", confirmed, evidence: "x", source: "gmail/thread/x" },
});
// Logistics: 4 of 5 won. Retail: 1 of 5 won.
const history = [
  ...[1, 2, 3, 4].map((i) => past(`l${i}`, "logistics", true)), past("l5", "logistics", false),
  past("r1", "retail", true), ...[2, 3, 4, 5].map((i) => past(`r${i}`, "retail", false)),
  past("x", "logistics", false, false),
];

describe("priors and calibration", () => {
  it("pulls a small segment toward the overall rate", () => {
    const p = prior({ industry: "logistics", size: "200-1000" }, history);
    // overall 5/10; segment 4/5 → (4 + 2*0.5) / (5 + 2) = 5/7
    expect(p?.p).toBeCloseTo(5 / 7, 6);
    expect(p?.label).toBe("71% (logistics/200-1000, 5 similar of 10 deals)");
    expect(prior({ industry: "logistics" }, history.slice(0, 4))).toBeNull();
  });

  it("scores Brier against the base rate", () => {
    const c = calibrate([{ p: 0.9, y: 1 }, { p: 0.8, y: 1 }, { p: 0.2, y: 0 }, { p: 0.3, y: 1 }]);
    expect(c.brier).toBeCloseTo((0.01 + 0.04 + 0.04 + 0.49) / 4, 6);
    expect(c.baselineBrier).toBeCloseTo((3 * 0.0625 + 0.5625) / 4, 6);
    expect(c.buckets.find((b) => b.range === "80-100%")).toMatchObject({ n: 2, actual: 1 });
  });

  it("backtests on confirmed history only, predicting each deal from the others", () => {
    const b = backtest(history);
    expect(b.n).toBe(10);
    expect(b.brier).not.toBeNull();
    expect((b.brier ?? 1) < (b.baselineBrier ?? 0)).toBe(true);
    expect(backtest(history.slice(0, 5)).n).toBe(0);
  });
});
