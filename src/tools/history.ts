// Past deals: outcomes (unconfirmed until the user ticks them), ICP map, baseline, similar deals.

import { localToday } from "../dates.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { baseline, icpMap, joinDeals, similarDeals, winRate, type Deal } from "../history/stats.js";
import { parseHistory, readHistory } from "../memory/history.js";
import { parseOutcomes, upsertOutcome, type Outcome } from "../memory/outcomes.js";
import { parseSettings } from "../data/settings.js";
import { dataBlock } from "../server/data-block.js";
import { accountSlug, memoryWrite, quoteProblem, type MemoryDeps } from "./memory.js";

const OUTCOMES = "memory/history/outcomes.md";
const today = () => localToday();
const read = (dir: string, rel: string) => (existsSync(join(dir, rel)) ? readFileSync(join(dir, rel), "utf8") : "");

export interface NewOutcome {
  account: string;
  outcome: Outcome;
  closed?: string;
  value?: number;
  currency?: string;
  reason?: string;
  evidence: string;
  source: string;
}

export async function logOutcome(deps: MemoryDeps, o: NewOutcome): Promise<string> {
  const problem = await quoteProblem(deps, o.evidence.replace(/^["“]|["”]$/g, ""), o.source);
  if (problem) return `Not logged: the evidence ${problem.replace(/^the quote /, "")} Use the exact words that show the outcome.`;
  const account = accountSlug(o.account);
  const { md, keptConfirmation } = upsertOutcome(read(deps.dir, OUTCOMES), {
    ...o,
    account,
    evidence: o.evidence.replace(/^["“]|["”]$/g, ""),
    ...(o.currency ? { currency: o.currency.toUpperCase() } : {}),
  });
  await memoryWrite(deps, { path: OUTCOMES, content: md, mode: "replace" }, `Outcome for ${account}: ${o.outcome} (unconfirmed)`, true);
  return keptConfirmation
    ? `Updated ${account} (${o.outcome}); it was already confirmed with the same outcome, so it stays confirmed.`
    : `Logged ${account} as ${o.outcome}, not confirmed. The user confirms outcomes by ticking them in ${OUTCOMES} or running \`deal-harness confirm\`; until then this deal doesn't count in the ICP map or calibration.`;
}

export function loadDeals(dir: string): Deal[] {
  return joinDeals(readHistory(dir), parseOutcomes(read(dir, OUTCOMES)));
}

export async function historyStats(deps: MemoryDeps): Promise<string> {
  const deals = loadDeals(deps.dir);
  const d = today();
  await memoryWrite(deps, { path: "company/icp-map.md", content: icpMap(deals, d), mode: "replace" }, "Rebuild ICP map", true);
  await memoryWrite(deps, { path: "memory/history/baseline.md", content: baseline(deals, d), mode: "replace" }, "Rebuild calibration baseline", true);
  const w = winRate(deals);
  const pending = deals.filter((x) => x.outcome && !x.outcome.confirmed).length;
  const noOutcome = deals.filter((x) => !x.outcome).length;
  return [
    `Rebuilt company/icp-map.md and memory/history/baseline.md from ${w.total} confirmed, closed deals (${w.won} won).`,
    pending ? `${pending} outcome(s) wait for the user to confirm and aren't counted.` : "",
    noOutcome ? `${noOutcome} past deal(s) have no outcome logged yet.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function findSimilar(dir: string, target: { account?: string; industry?: string; size?: string; region?: string; competitor?: string; value?: number; currency?: string }, includeUnconfirmed: boolean, limit: number): string {
  let features = { ...target };
  if (target.account) {
    const slug = accountSlug(target.account);
    const md = read(dir, `memory/history/${slug}.md`) || read(dir, `memory/accounts/${slug}.md`);
    if (md) features = { ...parseHistory(slug, md), ...Object.fromEntries(Object.entries(target).filter(([, v]) => v !== undefined)), account: slug };
  }
  const matches = similarDeals(features, loadDeals(dir), { includeUnconfirmed, limit });
  if (matches.length === 0) return "No similar past deals with a confirmed outcome. (Confirm outcomes, or allow unconfirmed ones.)";
  const rows = matches.map((m) => {
    const o = m.deal.outcome;
    return [
      `${m.deal.name} (${m.deal.account}) · ${o?.outcome ?? "no outcome"}${o && !o.confirmed ? " (NOT confirmed)" : ""}${o?.reason ? ` · reason: ${o.reason}` : ""}`,
      `why similar: ${m.why.join(", ")}`,
      ...(m.deal.worked.length ? [`worked: ${m.deal.worked.join("; ")}`] : []),
      ...(m.deal.wentWrong.length ? [`went wrong: ${m.deal.wentWrong.join("; ")}`] : []),
    ].join("\n");
  });
  return dataBlock("memory/history/similar", rows.join("\n\n"));
}

export function scanDefaults(dir: string): { months: number; excludeDomains: string[]; excludeLabels: string[] } {
  const s = { ...parseSettings(read(dir, "config.md")), ...parseSettings(read(dir, "config.local.md")) };
  const list = (v: string | undefined) => (v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const months = Number(s["scan months"]);
  return { months: Number.isInteger(months) && months > 0 ? months : 12, excludeDomains: list(s["scan exclude domains"]), excludeLabels: list(s["scan exclude labels"]) };
}
