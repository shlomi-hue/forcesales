// Turn any rate card spreadsheet into price floors. Pure: takes cell text, no I/O.
//
// Works without a fixed layout: on each tab it finds header rows by their wording
// (a price column plus an item column), then reads the rows below. A later header row
// on the same tab starts a new section. Explicit column names can override the guessing.

import { currencyMentioned, findAmounts, parsePriceCell } from "./money.js";

export interface SheetTab {
  title: string;
  rows: string[][];
}

export type Role =
  | "id"
  | "name"
  | "floor"
  | "list"
  | "cost"
  | "max_discount"
  | "currency"
  | "unit"
  | "min_qty"
  | "max_qty"
  | "qty";

// Header names (any case) given by the user for each role, used instead of guessing.
export type ColumnOverrides = Partial<Record<Role, string | string[]>>;

export interface RateRow {
  // Every id and name the item goes by, normalized.
  names: string[];
  display: string;
  floor: number;
  // Where the floor came from: a floor column, list price minus max discount, or the list price.
  floorFrom: "floor" | "list-discount" | "list";
  currencies: string[];
  minQty?: number;
  maxQty?: number;
  // Words that tell variants apart: tab title, price column header, unit.
  labels: string[];
  where: string;
}

export interface RateCard {
  rows: RateRow[];
  warnings: string[];
}

export const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const QTY = String.raw`(qty|quantity|seats|units|users|licen[cs]es|volume|headcount|count)`;
const RULES: [Role, RegExp][] = [
  ["min_qty", new RegExp(String.raw`\b(min|minimum|from|start)\b.*\b${QTY}\b|\b${QTY}\b.*\b(min|from)\b`)],
  ["max_qty", new RegExp(String.raw`\b(max|maximum|to|up to|until|end)\b.*\b${QTY}\b|\b${QTY}\b.*\b(max|to)\b`)],
  ["qty", new RegExp(String.raw`\b${QTY}\b|\b(tier range|band|seat range)\b`)],
  ["max_discount", /\bdiscount\b/],
  ["floor", /\b(floor|minimum|min|lowest|walk ?away|bottom|reserve)\b/],
  ["cost", /\bcost\b/],
  ["list", /\b(price|pricing|rate|list|msrp|rrp|retail|fee|amount|charge|tariff|mrr|arr|monthly|annual|yearly|quarterly)\b/],
  ["currency", /\b(currency|ccy|cur|curr)\b/],
  ["unit", /\b(unit|per|uom|billing|period|frequency|term)\b/],
  ["id", /\b(sku|code|id|part|ref|reference|item no|article)\b/],
  ["name", /\b(product|item|name|service|plan|package|offering|description|module|edition|tier|title|line item|bundle)\b/],
];

const PRICE_ROLES: Role[] = ["floor", "list", "cost", "max_discount"];

function roleOf(header: string, overrides: Map<string, Role> | null): Role | null {
  const h = norm(header);
  if (!h) return null;
  if (overrides) return overrides.get(h) ?? null;
  for (const [role, re] of RULES) if (re.test(h)) return role;
  return null;
}

interface Section {
  cols: { index: number; role: Role; header: string }[];
  headerRow: number;
}

function readHeader(row: string[], overrides: Map<string, Role> | null): Section["cols"] | null {
  const cols = row
    .map((cell, index) => ({ index, role: roleOf(cell ?? "", overrides), header: (cell ?? "").trim() }))
    .filter((c): c is { index: number; role: Role; header: string } => c.role !== null);
  if (!cols.some((c) => PRICE_ROLES.includes(c.role))) return null;
  // A data row can't look like a header: header cells hold no prices or bare numbers.
  if (row.some((c) => /^\s*\d[\d.,\s]*$/.test(c ?? "") || findAmounts(c ?? "").length > 0)) return null;
  if (cols.some((c) => c.role === "id" || c.role === "name")) return cols;
  // No item column named: use the leftmost unlabelled column before the prices.
  const firstPrice = Math.min(...cols.filter((c) => PRICE_ROLES.includes(c.role)).map((c) => c.index));
  let fallback = -1;
  for (let i = 0; i < firstPrice && fallback < 0; i++) if (!cols.some((k) => k.index === i)) fallback = i;
  if (fallback < 0) return null;
  return [...cols, { index: fallback, role: "name", header: (row[fallback] ?? "").trim() || "item" }];
}

function parseQtyRange(cell: string): { min?: number; max?: number } {
  const s = cell.replace(/[,\s]/g, "");
  let m = s.match(/(\d+)(?:-|–|—|to)(\d+)/i);
  if (m) return { min: Number(m[1]), max: Number(m[2]) };
  m = s.match(/(\d+)\+|(?:>=|≥|over|from|atleast)(\d+)/i);
  if (m) return { min: Number(m[1] ?? m[2]) };
  m = s.match(/(?:upto|<=|≤|max|under)(\d+)/i);
  if (m) return { max: Number(m[1]) };
  m = s.match(/^(\d+)$/);
  return m ? { min: Number(m[1]) } : {};
}

function parsePercent(cell: string): number | null {
  const m = cell.match(/(\d+(?:[.,]\d+)?)\s*%?/);
  if (!m?.[1]) return null;
  const v = Number(m[1].replace(",", "."));
  const frac = cell.includes("%") || v > 1 ? v / 100 : v;
  return frac >= 0 && frac < 1 ? frac : null;
}

const colLetter = (i: number): string =>
  (i >= 26 ? colLetter(Math.floor(i / 26) - 1) : "") + String.fromCharCode(65 + (i % 26));

export function parseRateCard(tabs: SheetTab[], overrides?: ColumnOverrides): RateCard {
  const rows: RateRow[] = [];
  const warnings: string[] = [];
  const overrideMap = overrides ? toOverrideMap(overrides) : null;

  for (const tab of tabs) {
    let section: Section | null = null;
    let carry: { names: string[]; display: string } | null = null;
    let found = 0;

    for (const [r, row] of tab.rows.entries()) {
      const header = readHeader(row, overrideMap);
      if (header) {
        section = { cols: header, headerRow: r };
        carry = null;
        continue;
      }
      if (!section) continue;
      const cols = section.cols;
      const cells = (role: Role) => cols.filter((c) => c.role === role).map((c) => ({ ...c, text: (row[c.index] ?? "").trim() }));

      const idCells = [...cells("id"), ...cells("name")].filter((c) => c.text !== "");
      let names = idCells.map((c) => norm(c.text)).filter(Boolean);
      let display = idCells[0]?.text ?? "";
      if (names.length === 0) {
        // Merged cells for tiers: a row without a name belongs to the item above it.
        if (!carry) continue;
        ({ names, display } = carry);
      } else {
        carry = { names, display };
      }

      const rowCurrency = cells("currency").map((c) => currencyMentioned(c.text.toUpperCase()))[0] ?? [];
      const unit = cells("unit").map((c) => c.text).filter(Boolean);
      const qty = cells("qty").map((c) => parseQtyRange(c.text))[0] ?? {};
      const minQty = numberIn(cells("min_qty")[0]?.text) ?? qty.min;
      const maxQty = numberIn(cells("max_qty")[0]?.text) ?? qty.max;
      const discount = cells("max_discount").map((c) => parsePercent(c.text)).find((d) => d !== null) ?? null;

      const floors = cells("floor").filter((c) => c.text !== "");
      const lists = cells("list").filter((c) => c.text !== "");
      const costs = cells("cost").filter((c) => c.text !== "");
      // A cost column is a price only when nothing better is there.
      const priceCols: { col: { header: string; text: string; index: number }; from: RateRow["floorFrom"] }[] =
        floors.length > 0
          ? floors.map((col) => ({ col, from: "floor" }))
          : (lists.length > 0 ? lists : costs).map((col) => ({ col, from: discount !== null ? "list-discount" : "list" }));

      for (const { col, from } of priceCols) {
        const price = parsePriceCell(col.text);
        if (!price) continue;
        const currencies = rowCurrency.length ? rowCurrency : price.currencies.length ? price.currencies : currencyMentioned(col.header);
        const floor = from === "list-discount" ? round2(price.value * (1 - (discount ?? 0))) : price.value;
        rows.push({
          names,
          display,
          floor,
          floorFrom: from,
          currencies,
          ...(minQty !== undefined ? { minQty } : {}),
          ...(maxQty !== undefined ? { maxQty } : {}),
          labels: [tab.title, col.header, ...unit].map(norm).filter(Boolean),
          where: `'${tab.title}'!${colLetter(col.index)}${r + 1}`,
        });
        found++;
      }
    }

    if (found === 0) warnings.push(`Tab '${tab.title}': no prices found (no header row with an item column and a price column).`);
  }

  return { rows, warnings };
}

function toOverrideMap(o: ColumnOverrides): Map<string, Role> {
  const m = new Map<string, Role>();
  for (const [role, headers] of Object.entries(o) as [Role, string | string[]][]) {
    for (const h of Array.isArray(headers) ? headers : [headers]) m.set(norm(h), role);
  }
  return m;
}

function numberIn(text: string | undefined): number | undefined {
  const m = text?.replace(/,/g, "").match(/\d+/);
  return m ? Number(m[0]) : undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
