// Forecasts, scenarios, priors and calibration. All arithmetic lives here, never in the model.

import type { Deal } from "../history/stats.js";
import type { PipelineDeal } from "../pipeline/deals.js";

export interface Period {
  label: string;
  from: string;
  to: string;
}

const pad = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// "2026-Q4", "2026-11", "2026", or nothing for the quarter containing `today`.
export function parsePeriod(label: string | undefined, today: string): Period {
  const t = (label ?? "").trim().toUpperCase();
  let m = t.match(/^(\d{4})-?Q([1-4])$/);
  if (!t) {
    const [y, mo] = today.split("-").map(Number);
    m = [today, String(y), String(Math.floor(((mo ?? 1) - 1) / 3) + 1)] as unknown as RegExpMatchArray;
  }
  if (m) {
    const y = Number(m[1]);
    const q = Number(m[2]);
    const endMonth = q * 3;
    return { label: `${y}-Q${q}`, from: `${y}-${pad(endMonth - 2)}-01`, to: `${y}-${pad(endMonth)}-${lastDay(y, endMonth)}` };
  }
  const mo = t.match(/^(\d{4})-(\d{1,2})$/);
  if (mo) {
    const y = Number(mo[1]);
    const n = Number(mo[2]);
    return { label: `${y}-${pad(n)}`, from: `${y}-${pad(n)}-01`, to: `${y}-${pad(n)}-${lastDay(y, n)}` };
  }
  const yr = t.match(/^(\d{4})$/);
  if (yr) return { label: yr[1] ?? t, from: `${yr[1]}-01-01`, to: `${yr[1]}-12-31` };
  throw new Error(`Period "${label}" not understood. Use 2026-Q4, 2026-11 or 2026.`);
}

export interface ForecastDeal extends PipelineDeal {
  // The harness's latest probability (0..1), if it has set one.
  harnessProbability?: number;
}

export interface Line {
  account: string;
  value: number;
  currency: string;
  p: number;
  pFrom: "won" | "harness" | "sheet";
  close: string;
}

export interface Forecast {
  period: Period;
  lines: Line[];
  // Deals in the period that can't be counted, and why.
  skipped: { account: string; why: string }[];
  totals: Record<string, { won: number; expected: number; likely: number; possible: number }>;
}

const cur = (d: PipelineDeal) => (d.currency.length === 1 ? (d.currency[0] as string) : d.currency.length ? d.currency.join("/") : "?");
const round2 = (n: number) => Math.round(n * 100) / 100;

// expected = won + Σ value × p over open deals; likely = won + deals at p ≥ 50%; possible = won + every open deal.
export function forecast(deals: ForecastDeal[], period: Period): Forecast {
  const lines: Line[] = [];
  const skipped: Forecast["skipped"] = [];
  for (const d of deals) {
    if (d.status === "lost") continue;
    if (!d.close || d.close < period.from || d.close > period.to) continue;
    if (d.value === undefined) {
      skipped.push({ account: d.account, why: "no value" });
      continue;
    }
    if (d.status === "won") {
      lines.push({ account: d.account, value: d.value, currency: cur(d), p: 1, pFrom: "won", close: d.close });
      continue;
    }
    const p = d.harnessProbability ?? d.sheetProbability;
    if (p === undefined) {
      skipped.push({ account: d.account, why: "no probability yet (set one with probability_set)" });
      continue;
    }
    lines.push({ account: d.account, value: d.value, currency: cur(d), p, pFrom: d.harnessProbability !== undefined ? "harness" : "sheet", close: d.close });
  }
  const totals: Forecast["totals"] = {};
  for (const l of lines) {
    const t = (totals[l.currency] ??= { won: 0, expected: 0, likely: 0, possible: 0 });
    if (l.pFrom === "won") t.won += l.value;
    t.expected += l.value * l.p;
    if (l.p >= 0.5) t.likely += l.value;
    t.possible += l.value;
  }
  for (const t of Object.values(totals)) for (const k of ["won", "expected", "likely", "possible"] as const) t[k] = round2(t[k]);
  return { period, lines, skipped, totals };
}

export interface Change {
  account: string;
  probability?: number;
  value?: number;
  close?: string;
  // "lost" removes the deal; "won" counts it at 100%.
  status?: "won" | "lost";
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function applyChanges(deals: ForecastDeal[], changes: Change[]): { deals: ForecastDeal[]; unknown: string[] } {
  const unknown = changes.filter((c) => !deals.some((d) => same(d.account, c.account))).map((c) => c.account);
  const next = deals.map((d) => {
    const c = changes.find((x) => same(x.account, d.account));
    if (!c) return d;
    return {
      ...d,
      ...(c.value !== undefined ? { value: c.value } : {}),
      ...(c.close ? { close: c.close } : {}),
      ...(c.probability !== undefined ? { harnessProbability: c.probability } : {}),
      ...(c.status ? { status: c.status } : {}),
    };
  });
  return { deals: next, unknown };
}

export function scenario(deals: ForecastDeal[], period: Period, changes: Change[]) {
  const base = forecast(deals, period);
  const applied = applyChanges(deals, changes);
  const after = forecast(applied.deals, period);
  const currencies = [...new Set([...Object.keys(base.totals), ...Object.keys(after.totals)])];
  const zero = { won: 0, expected: 0, likely: 0, possible: 0 };
  const delta = Object.fromEntries(
    currencies.map((c) => {
      const b = base.totals[c] ?? zero;
      const a = after.totals[c] ?? zero;
      return [c, { won: round2(a.won - b.won), expected: round2(a.expected - b.expected), likely: round2(a.likely - b.likely), possible: round2(a.possible - b.possible) }];
    }),
  );
  return { base, after, delta, unknown: applied.unknown };
}

export function formatForecast(f: Forecast): string {
  const rows = f.lines
    .sort((a, b) => b.value * b.p - a.value * a.p)
    .map((l) => `| ${l.account} | ${l.value} ${l.currency} | ${Math.round(l.p * 100)}% (${l.pFrom}) | ${l.close} | ${round2(l.value * l.p)} |`);
  const totals = Object.entries(f.totals).map(
    ([c, t]) => `- ${c}: won ${t.won} · expected ${t.expected} · likely (≥50%) ${t.likely} · possible ${t.possible}`,
  );
  return [
    `Forecast for ${f.period.label} (${f.period.from} to ${f.period.to}), computed in code. Currencies are never added together.`,
    "",
    ...(totals.length ? totals : ["- nothing closing in this period"]),
    "",
    ...(rows.length ? ["| Deal | Value | Probability | Close | Expected |", "|---|---|---|---|---|", ...rows] : []),
    ...(f.skipped.length ? ["", "Not counted:", ...f.skipped.map((s) => `- ${s.account}: ${s.why}`)] : []),
  ].join("\n");
}

// ---------- priors and calibration ----------

const SHRINK = 2;
const closedConfirmed = (d: Deal) => d.outcome?.confirmed === true && d.outcome.outcome !== "open";
const won = (d: Deal) => (d.outcome?.outcome === "won" ? 1 : 0);
const segment = (d: { industry?: string; size?: string }) => `${(d.industry ?? "").toLowerCase()}|${(d.size ?? "").toLowerCase()}`;

export interface Prior {
  p: number;
  overall: number;
  segmentDeals: number;
  totalDeals: number;
  label: string;
}

// Base rate for a deal like this: its industry+size segment's win rate, pulled toward the
// overall rate when the segment is small. null with fewer than 5 confirmed deals in all.
export function prior(target: { industry?: string; size?: string; account?: string }, history: Deal[]): Prior | null {
  const pool = history.filter((d) => closedConfirmed(d) && d.account !== target.account);
  if (pool.length < 5) return null;
  const overall = pool.reduce((s, d) => s + won(d), 0) / pool.length;
  const seg = target.industry || target.size ? pool.filter((d) => segment(d) === segment(target)) : [];
  const p = (seg.reduce((s, d) => s + won(d), 0) + SHRINK * overall) / (seg.length + SHRINK);
  const name = [target.industry, target.size].filter(Boolean).join("/") || "all deals";
  return { p, overall, segmentDeals: seg.length, totalDeals: pool.length, label: `${Math.round(p * 100)}% (${name}, ${seg.length} similar of ${pool.length} deals)` };
}

export interface Calibration {
  n: number;
  brier: number | null;
  baselineBrier: number | null;
  buckets: { range: string; n: number; predicted: number | null; actual: number | null }[];
}

export function calibrate(pairs: { p: number; y: number }[], baselineP?: number): Calibration {
  const n = pairs.length;
  const brier = n ? pairs.reduce((s, x) => s + (x.p - x.y) ** 2, 0) / n : null;
  const rate = baselineP ?? (n ? pairs.reduce((s, x) => s + x.y, 0) / n : 0);
  const baselineBrier = n ? pairs.reduce((s, x) => s + (rate - x.y) ** 2, 0) / n : null;
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const buckets = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1] as number;
    const inB = pairs.filter((x) => x.p >= lo && x.p < hi);
    const avg = (f: (x: { p: number; y: number }) => number) => (inB.length ? inB.reduce((s, x) => s + f(x), 0) / inB.length : null);
    return { range: `${Math.round(lo * 100)}-${Math.min(100, Math.round(hi * 100))}%`, n: inB.length, predicted: avg((x) => x.p), actual: avg((x) => x.y) };
  });
  return { n, brier, baselineBrier, buckets };
}

// Backtest on confirmed history: predict each deal from all the others, then score.
export function backtest(history: Deal[]): Calibration {
  const pool = history.filter(closedConfirmed);
  // Each prediction needs at least 5 other deals to learn from.
  if (pool.length < 6) return calibrate([]);
  return calibrate(pool.map((d) => ({ p: (prior(d, pool) as Prior).p, y: won(d) })));
}

export function formatCalibration(title: string, c: Calibration, minN = 5): string {
  const f = (x: number | null) => (x === null ? "-" : x.toFixed(3));
  const p = (x: number | null) => (x === null ? "-" : `${Math.round(x * 100)}%`);
  if (c.n < minN) return `## ${title}\n\ntoo few (${c.n}) to score.\n`;
  return [
    `## ${title}`,
    "",
    `- deals scored: ${c.n}`,
    `- Brier score: ${f(c.brier)} (0 is perfect; lower is better)`,
    `- Brier score of always guessing the base rate: ${f(c.baselineBrier)}`,
    `- ${c.brier !== null && c.baselineBrier !== null ? (c.brier < c.baselineBrier ? "Better than the base rate." : "Not better than the base rate.") : ""}`,
    "",
    "| Predicted | Deals | Avg predicted | Actually won |",
    "|---|---|---|---|",
    ...c.buckets.map((b) => `| ${b.range} | ${b.n} | ${p(b.predicted)} | ${b.n < minN && b.n > 0 ? `too few (${b.n})` : p(b.actual)} |`),
    "",
  ].join("\n");
}
