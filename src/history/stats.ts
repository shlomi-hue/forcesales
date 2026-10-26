// Numbers from past deals, computed here and never by the model. Only confirmed outcomes count.

import type { PastDeal } from "../memory/history.js";
import type { OutcomeLine } from "../memory/outcomes.js";

export const MIN_CELL = 5;

export interface Deal extends PastDeal {
  outcome?: OutcomeLine;
}

export function joinDeals(history: PastDeal[], outcomes: OutcomeLine[]): Deal[] {
  const byAccount = new Map(outcomes.map((o) => [o.account, o]));
  return history.map((h) => ({ ...h, ...(byAccount.has(h.account) ? { outcome: byAccount.get(h.account) } : {}) }));
}

const closed = (d: Deal) => d.outcome?.confirmed === true && d.outcome.outcome !== "open";
const norm = (s: string | undefined) => (s ?? "").trim().toLowerCase();

export function winRate(deals: Deal[]): { won: number; total: number; rate: number | null } {
  const c = deals.filter(closed);
  const won = c.filter((d) => d.outcome?.outcome === "won").length;
  return { won, total: c.length, rate: c.length ? won / c.length : null };
}

const pct = (r: number | null) => (r === null ? "-" : `${Math.round(r * 100)}%`);
const cell = (deals: Deal[]) => {
  const w = winRate(deals);
  return w.total < MIN_CELL ? `too few (${w.total})` : `${w.won}/${w.total} won (${pct(w.rate)})`;
};

function groups(deals: Deal[], key: (d: Deal) => string | undefined): Map<string, Deal[]> {
  const m = new Map<string, Deal[]>();
  for (const d of deals.filter(closed)) {
    const k = key(d)?.trim() || "unknown";
    const label = [...m.keys()].find((x) => norm(x) === norm(k)) ?? k;
    m.set(label, [...(m.get(label) ?? []), d]);
  }
  return new Map([...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])));
}

export function icpMap(deals: Deal[], today: string): string {
  const confirmed = deals.filter(closed);
  const pending = deals.filter((d) => d.outcome && !d.outcome.confirmed).length;
  const out = [
    "# ICP map",
    "",
    `Built by history_stats on ${today} from ${confirmed.length} confirmed, closed past deals (${pending} more await confirmation and aren't counted). Win rate = won / (won + lost + no-decision). Cells with fewer than ${MIN_CELL} deals say "too few".`,
    "",
  ];
  const industries = [...groups(deals, (d) => d.industry).keys()];
  const sizes = [...groups(deals, (d) => d.size).keys()];
  if (industries.length && sizes.length) {
    out.push("## Industry by company size", "", `| Industry | ${sizes.join(" | ")} | All sizes |`, `|---|${sizes.map(() => "---").join("|")}|---|`);
    for (const ind of industries) {
      const row = confirmed.filter((d) => norm(d.industry || "unknown") === norm(ind));
      out.push(`| ${ind} | ${sizes.map((s) => cell(row.filter((d) => norm(d.size || "unknown") === norm(s)))).join(" | ")} | ${cell(row)} |`);
    }
    out.push(`| All industries | ${sizes.map((s) => cell(confirmed.filter((d) => norm(d.size || "unknown") === norm(s)))).join(" | ")} | ${cell(confirmed)} |`, "");
  }
  for (const [title, key] of [
    ["Region", (d: Deal) => d.region],
    ["Competitor", (d: Deal) => d.competitor ?? "none named"],
  ] as const) {
    const g = groups(deals, key);
    if (g.size === 0) continue;
    out.push(`## By ${title.toLowerCase()}`, "", `| ${title} | Win rate |`, "|---|---|", ...[...g.entries()].map(([k, v]) => `| ${k} | ${cell(v)} |`), "");
  }
  return `${out.join("\n").trimEnd()}\n`;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] ?? null) : ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
};
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function baseline(deals: Deal[], today: string): string {
  const confirmed = deals.filter(closed);
  const w = winRate(deals);
  const won = confirmed.filter((d) => d.outcome?.outcome === "won");
  const cycles = won.filter((d) => d.firstContact && (d.outcome?.closed ?? d.lastContact)).map((d) => days(d.firstContact as string, (d.outcome?.closed ?? d.lastContact) as string)).filter((n) => n >= 0);
  const values = new Map<string, number[]>();
  for (const d of won) if (d.value !== undefined) values.set(d.currency ?? "?", [...(values.get(d.currency ?? "?") ?? []), d.value]);
  const reasons = new Map<string, number>();
  for (const d of confirmed.filter((x) => x.outcome?.outcome !== "won")) {
    const r = d.outcome?.reason?.trim();
    if (r) reasons.set(r, (reasons.get(r) ?? 0) + 1);
  }
  const lines = [
    "# Calibration baseline",
    "",
    `Built by history_stats on ${today} from confirmed, closed past deals only. Phase 6 scores forecasts against these base rates.`,
    "",
    "## Base rates",
    `- confirmed closed deals: ${w.total}`,
    `- won: ${w.won}`,
    `- win rate: ${w.total < MIN_CELL ? `too few (${w.total})` : pct(w.rate)}`,
    `- median days from first contact to close (won deals): ${median(cycles) ?? "-"}${cycles.length ? ` (from ${cycles.length} deals)` : ""}`,
    ...[...values.entries()].map(([cur, v]) => `- median won deal value: ${median(v)} ${cur} (from ${v.length} deals)`),
    "",
    "## Why deals were lost or stalled",
    ...(reasons.size ? [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `- ${r}: ${n}`) : ["- none recorded"]),
  ];
  return `${lines.join("\n")}\n`;
}

export interface Match {
  deal: Deal;
  score: number;
  why: string[];
}

// Past deals most like this one, by shared features. Same industry and competitor weigh most.
export function similarDeals(target: Partial<PastDeal>, deals: Deal[], opts: { includeUnconfirmed?: boolean; limit?: number } = {}): Match[] {
  const pool = deals.filter((d) => d.account !== target.account && (opts.includeUnconfirmed ? d.outcome : closed(d)));
  const scored = pool.map((d) => {
    const why: string[] = [];
    let score = 0;
    const add = (points: number, reason: string) => {
      score += points;
      why.push(reason);
    };
    if (target.industry && norm(d.industry) === norm(target.industry)) add(3, "same industry");
    if (target.competitor && norm(d.competitor) === norm(target.competitor)) add(2, `also against ${d.competitor}`);
    if (target.size && norm(d.size) === norm(target.size)) add(2, "same size");
    if (target.region && norm(d.region) === norm(target.region)) add(1, "same region");
    if (target.value && d.value && (!target.currency || !d.currency || target.currency === d.currency)) {
      const ratio = Math.max(target.value, d.value) / Math.min(target.value, d.value);
      if (ratio <= 2) add(2, "similar value");
    }
    return { deal: d, score, why };
  });
  return scored
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || (b.deal.lastContact ?? "").localeCompare(a.deal.lastContact ?? ""))
    .slice(0, opts.limit ?? 5);
}
