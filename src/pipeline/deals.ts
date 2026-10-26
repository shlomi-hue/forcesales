// The deals Sheet (no CRM in v1): one row per deal, any layout. Header rows are found by their
// wording, like the rate card. Numbers and dates are read from raw cell values.

import { currencyMentioned, parsePriceCell } from "../checks/money.js";
import { norm, type SheetTab } from "../checks/rate-card.js";

export type DealRole = "account" | "value" | "currency" | "stage" | "close" | "probability" | "owner";
export type DealColumns = Partial<Record<DealRole, string | string[]>>;

export interface PipelineDeal {
  account: string;
  value?: number;
  currency: string[];
  stage: string;
  close?: string;
  // From the Sheet's own probability column, 0..1, if it has one.
  sheetProbability?: number;
  owner?: string;
  status: "open" | "won" | "lost";
  where: string;
}

const RULES: [DealRole, RegExp][] = [
  ["probability", /\b(probability|prob|likelihood|chance|confidence|win %|weight(ing)?)\b/],
  ["close", /\b(close|closing|expected close|close date|target date|decision date|due)\b/],
  ["currency", /\b(currency|ccy|cur|curr)\b/],
  ["value", /\b(value|amount|acv|arr|tcv|mrr|deal size|revenue|price|total|contract value|budget)\b/],
  ["stage", /\b(stage|status|phase|step)\b/],
  ["owner", /\b(owner|rep|ae|salesperson|account manager)\b/],
  ["account", /\b(account|company|customer|client|prospect|deal|opportunity|organisation|organization|name|logo)\b/],
];

const WON = /\b(closed[ -]?won|won|signed|booked|live|customer)\b/i;
const LOST = /\b(closed[ -]?lost|lost|dead|disqualified|no[ -]decision|churned|cancel+ed)\b/i;

function roleOf(header: string, overrides: Map<string, DealRole> | null): DealRole | null {
  const h = norm(header);
  if (!h) return null;
  if (overrides) return overrides.get(h) ?? null;
  for (const [role, re] of RULES) if (re.test(h)) return role;
  return null;
}

// Sheets serial day number (days since 1899-12-30) or a date string, to YYYY-MM-DD.
export function toIsoDate(v: string): string | undefined {
  const t = v.trim();
  if (/^\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (n > 20000 && n < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86_400_000).toISOString().slice(0, 10);
    return undefined;
  }
  const iso = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${iso[1]}-${iso[2]?.padStart(2, "0")}-${iso[3]?.padStart(2, "0")}`;
  // Day-first or month-first number dates ("11/12/2026") are ambiguous: never guess.
  if (/^\d+[/.-]\d+[/.-]\d+$/.test(t)) return undefined;
  const parsed = new Date(t);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // A date without a time zone parses as local midnight: read it back in local time, not UTC.
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function probability(v: string): number | undefined {
  const m = v.trim().match(/^(\d+(?:\.\d+)?)\s*(%)?$/);
  if (!m) return undefined;
  const n = Number(m[1]);
  const p = m[2] || n > 1 ? n / 100 : n;
  return p >= 0 && p <= 1 ? p : undefined;
}

// formatted: what the Sheet shows (for currency symbols and text); raw: unformatted values.
export function parsePipeline(formatted: SheetTab[], raw: SheetTab[], overrides?: DealColumns): { deals: PipelineDeal[]; warnings: string[] } {
  const ov = overrides ? new Map(Object.entries(overrides).flatMap(([role, h]) => (Array.isArray(h) ? h : [h]).map((x) => [norm(x), role as DealRole]))) : null;
  const deals: PipelineDeal[] = [];
  const warnings: string[] = [];
  formatted.forEach((tab, t) => {
    const rawRows = raw[t]?.rows ?? tab.rows;
    let cols: { index: number; role: DealRole; header: string }[] | null = null;
    let found = 0;
    tab.rows.forEach((row, r) => {
      const header = row.map((c, index) => ({ index, role: roleOf(c ?? "", ov), header: (c ?? "").trim() })).filter((c): c is { index: number; role: DealRole; header: string } => c.role !== null);
      const roles = new Set(header.map((c) => c.role));
      if (roles.has("account") && (roles.has("value") || roles.has("stage") || roles.has("close"))) {
        cols = header;
        return;
      }
      if (!cols) return;
      const get = (role: DealRole, from: string[] = row) => (cols ?? []).filter((c) => c.role === role).map((c) => String(from[c.index] ?? "").trim()).find(Boolean) ?? "";
      const account = get("account");
      if (!account) return;
      const stage = get("stage");
      const valueCell = get("value");
      const rawValue = get("value", rawRows[r]);
      const value = /^\d+(\.\d+)?$/.test(rawValue) ? Number(rawValue) : parsePriceCell(valueCell)?.value;
      const valueHeader = (cols ?? []).find((c) => c.role === "value")?.header ?? "";
      const currency = get("currency") ? currencyMentioned(get("currency").toUpperCase()) : parsePriceCell(valueCell)?.currencies.length ? (parsePriceCell(valueCell)?.currencies ?? []) : currencyMentioned(valueHeader);
      const close = toIsoDate(get("close", rawRows[r])) ?? toIsoDate(get("close"));
      const prob = probability(get("probability", rawRows[r])) ?? probability(get("probability"));
      const owner = get("owner");
      deals.push({
        account,
        ...(value !== undefined ? { value } : {}),
        currency,
        stage,
        ...(close ? { close } : {}),
        ...(prob !== undefined ? { sheetProbability: prob } : {}),
        ...(owner ? { owner } : {}),
        status: LOST.test(stage) ? "lost" : WON.test(stage) ? "won" : "open",
        where: `'${tab.title}'!row ${r + 1}`,
      });
      found++;
    });
    if (found === 0) warnings.push(`Tab '${tab.title}': no deals found (no header row with an account column and a value, stage or close date column).`);
  });
  return { deals, warnings };
}
