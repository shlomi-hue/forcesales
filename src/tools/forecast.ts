// Pipeline, probabilities, forecasts, scenarios and calibration: the numbers come from code.

import { localToday } from "../dates.js";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { backtest, calibrate, formatCalibration, prior, type ForecastDeal } from "../forecast/model.js";
import { parseHistory } from "../memory/history.js";
import { formatProbability, parseProbabilities } from "../memory/probabilities.js";
import type { PipelineDeal } from "../pipeline/deals.js";
import { loadDeals } from "./history.js";
import { accountSlug, memoryWrite, type MemoryDeps } from "./memory.js";

const today = () => localToday();
const read = (dir: string, rel: string) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), "utf8") : "");
const probFile = (account: string) => `memory/deals/${accountSlug(account)}/probabilities.md`;

export function latestProbability(dir: string, account: string): number | undefined {
  return parseProbabilities(read(dir, probFile(account))).at(-1)?.p;
}

export function withHarnessProbabilities(dir: string, deals: PipelineDeal[]): ForecastDeal[] {
  return deals.map((d) => {
    const p = latestProbability(dir, d.account);
    return p === undefined ? d : { ...d, harnessProbability: p };
  });
}

// The account's features from its account file (or past-deal file), for the prior.
function features(dir: string, account: string) {
  const slug = accountSlug(account);
  const md = read(dir, `memory/accounts/${slug}.md`) || read(dir, `memory/history/${slug}.md`);
  return { ...parseHistory(slug, md), account: slug };
}

export function dealPrior(dir: string, account: string): string {
  const f = features(dir, account);
  const p = prior(f, loadDeals(dir));
  if (!p) return `No base rate yet: fewer than 5 confirmed past deals. Run /history and confirm outcomes first.`;
  const missing = [!f.industry && "industry", !f.size && "size"].filter(Boolean);
  return [
    `Base rate for ${account}: ${p.label}.`,
    `Overall win rate: ${Math.round(p.overall * 100)}% across ${p.totalDeals} confirmed deals.`,
    p.segmentDeals < 5 ? `Only ${p.segmentDeals} similar deals, so this leans on the overall rate.` : "",
    missing.length ? `The account file has no ${missing.join(" or ")} line, so it can't be matched to a segment. Add them to sharpen this.` : "",
    "Start from this base rate and move it only for evidence you can point to (signals with quotes).",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function setProbability(deps: MemoryDeps, account: string, percent: number, why: string): Promise<string> {
  const p = prior(features(deps.dir, account), loadDeals(deps.dir));
  const rel = probFile(account);
  const prev = read(deps.dir, rel);
  const header = prev ? "" : `# Win probability · ${account}\n\nAppend-only: each line is what the harness believed that day. Calibration scores these against confirmed outcomes.\n\n`;
  const line = formatProbability({ date: today(), p: percent / 100, ...(p ? { prior: p.label } : {}), why });
  await memoryWrite(deps, { path: rel, content: `${header}${line}\n`, mode: "append" }, `Probability for ${account}: ${percent}%`, true);
  const gap = p ? Math.round(percent - p.p * 100) : null;
  return `Logged ${percent}% for ${account}${p ? ` (base rate ${Math.round(p.p * 100)}%, ${gap !== null && gap >= 0 ? "+" : ""}${gap} points)` : ""}.`;
}

export async function calibrationScore(deps: MemoryDeps): Promise<string> {
  const history = loadDeals(deps.dir);
  const back = backtest(history);

  // Live predictions: the last probability logged on or before each confirmed close.
  const pairs: { p: number; y: number }[] = [];
  const deals = join(deps.dir, "memory", "deals");
  const outcomes = new Map(history.filter((d) => d.outcome?.confirmed && d.outcome.outcome !== "open").map((d) => [d.account, d.outcome]));
  if (existsSync(deals)) {
    for (const acct of readdirSync(deals)) {
      const o = outcomes.get(acct);
      if (!o) continue;
      const entries = parseProbabilities(read(deps.dir, `memory/deals/${acct}/probabilities.md`)).filter((e) => !o.closed || e.date <= o.closed);
      const last = entries.at(-1);
      if (last) pairs.push({ p: last.p, y: o.outcome === "won" ? 1 : 0 });
    }
  }
  const live = calibrate(pairs);
  const md = [
    "# Calibration",
    "",
    `Built by calibration_score on ${today()}, from confirmed outcomes only. Computed in code.`,
    "",
    formatCalibration("Backtest on past deals (each predicted from the base rates of all the others)", back),
    formatCalibration("The harness's own forecasts (last probability logged before each close)", live),
  ].join("\n");
  await memoryWrite(deps, { path: "memory/history/calibration.md", content: md, mode: "replace" }, "Rebuild calibration report", true);
  return md;
}
