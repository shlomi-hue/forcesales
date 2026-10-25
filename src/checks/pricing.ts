// pricing.check: refuse a draft that quotes a price below the rate card floor,
// or that mentions a money amount it didn't declare. Pure function.

import { currenciesCompatible, findAmounts, type MoneyAmount } from "./money.js";
import { matchItem, norm, type RateCard, type RateRow } from "./rate-card.js";

export interface DeclaredPrice {
  // Item name or code as it appears in the rate card.
  item: string;
  unit_price: number;
  quantity?: number;
  // ISO code, e.g. "USD". Taken from the body when left out.
  currency?: string;
  // Tells apart several prices for one item: "annual", a tab name, a column header.
  variant?: string;
}

export interface CheckResult {
  ok: boolean;
  reasons: string[];
}

const EPS = 0.005;
const near = (a: number, b: number) => Math.abs(a - b) < EPS;
const fmt = (n: number, cur: string[]) => `${Number.isInteger(n) ? n : n.toFixed(2)}${cur.length === 1 ? ` ${cur[0]}` : ""}`;

export function pricingCheck(input: { body: string; prices: DeclaredPrice[]; card: RateCard | null }): CheckResult {
  const { body, prices } = input;
  const reasons: string[] = [];
  const amounts = findAmounts(body);

  if (prices.length === 0 && amounts.length === 0) return { ok: true, reasons };
  const card = input.card;
  if (!card || card.rows.length === 0) {
    const why = card?.warnings.length ? ` (${card.warnings.join(" ")})` : "";
    return { ok: false, reasons: [`The draft has prices but no rate card could be read${why}. Can't check prices, so no draft was made.`] };
  }

  for (const p of prices) reasons.push(...checkOne(p, amounts, card));

  // Every money amount in the body must be a declared price, a line total or the grand total.
  const lineTotals = prices.filter((p) => p.quantity !== undefined).map((p) => p.unit_price * (p.quantity ?? 1));
  const allowed = [...prices.map((p) => p.unit_price), ...lineTotals];
  if (lineTotals.length > 1) allowed.push(lineTotals.reduce((a, b) => a + b, 0));
  for (const a of amounts) {
    if (!allowed.some((v) => near(v, a.value))) {
      reasons.push(
        `The body mentions "${a.raw}", which isn't a declared price, line total or grand total. Declare it in prices with its rate card item, or take it out.`,
      );
    }
  }

  return { ok: reasons.length === 0, reasons };
}

function checkOne(p: DeclaredPrice, amounts: MoneyAmount[], card: RateCard): string[] {
  const label = `"${p.item}" at ${fmt(p.unit_price, p.currency ? [p.currency.toUpperCase()] : [])}`;
  const match = matchItem(card, p.item);
  if ("error" in match) return [`${label}: ${match.error}`];
  let rows = match.rows;

  if (p.variant) {
    const v = norm(p.variant);
    const byVariant = rows.filter((r) => r.labels.some((l) => l.includes(v)));
    if (byVariant.length === 0) return [`${label}: no "${p.variant}" price for this item. Options: ${variantList(rows)}.`];
    rows = byVariant;
  }

  const currency = p.currency ? [p.currency.toUpperCase()] : currencyFromBody(p.unit_price, amounts);
  const sameCurrency = rows.filter((r) => currenciesCompatible(r.currencies, currency));
  if (sameCurrency.length === 0) {
    const has = [...new Set(rows.flatMap((r) => r.currencies))].join(", ");
    return [`${label}: the rate card prices this item in ${has}, not ${currency.join("/")}. The harness doesn't convert currencies.`];
  }
  rows = sameCurrency;

  const tiered = rows.some((r) => r.minQty !== undefined || r.maxQty !== undefined);
  if (p.quantity !== undefined && tiered) {
    const q = p.quantity;
    const inTier = rows.filter((r) => (r.minQty === undefined || q >= r.minQty) && (r.maxQty === undefined || q <= r.maxQty));
    if (inTier.length === 0) return [`${label}: no volume tier in the rate card covers quantity ${q}.`];
    rows = inTier;
  }

  // Several rows left (variants, or tiers without a quantity): the highest floor applies.
  const strictest = rows.reduce((a, b) => (b.floor > a.floor ? b : a));
  const loosest = rows.reduce((a, b) => (b.floor < a.floor ? b : a));
  if (p.unit_price + EPS >= strictest.floor) return [];

  const floorText = `${fmt(strictest.floor, strictest.currencies)} (${describeFloor(strictest)}, ${strictest.where})`;
  if (rows.length > 1 && p.unit_price + EPS >= loosest.floor) {
    const hint = tiered && p.quantity === undefined ? "Give the quantity" : "Give the variant";
    return [`${label} is below the highest floor that could apply, ${floorText}. ${hint} so the right price row is used. Options: ${variantList(rows)}.`];
  }
  return [`${label} is below the rate card floor of ${floorText}.`];
}

function currencyFromBody(price: number, amounts: MoneyAmount[]): string[] {
  const match = amounts.find((a) => near(a.value, price) && a.currencies.length > 0);
  return match?.currencies ?? [];
}

function describeFloor(r: RateRow): string {
  if (r.floorFrom === "floor") return "floor price";
  if (r.floorFrom === "list-discount") return "list price minus max discount";
  return "list price, no floor column";
}

function variantList(rows: RateRow[]): string {
  return rows
    .map((r) => {
      const tier = r.minQty !== undefined || r.maxQty !== undefined ? ` qty ${r.minQty ?? 0}-${r.maxQty ?? "∞"}` : "";
      return `${r.labels.join(" / ")}${tier}: floor ${fmt(r.floor, r.currencies)}`;
    })
    .join("; ");
}
