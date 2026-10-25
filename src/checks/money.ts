// Find money amounts in free text and parse numbers written in any common format.
// Pure functions: no I/O.

export interface MoneyAmount {
  raw: string;
  value: number;
  // Possible ISO codes. Empty means the currency is unknown (a bare number in a price context).
  currencies: string[];
  index: number;
}

const DOLLARS = ["USD", "SGD", "AUD", "CAD", "HKD", "NZD", "TWD", "MXN"];

// Longest first, so "US$" wins over "$".
const SYMBOLS: [string, string[]][] = [
  ["US$", ["USD"]],
  ["SG$", ["SGD"]],
  ["HK$", ["HKD"]],
  ["AU$", ["AUD"]],
  ["CA$", ["CAD"]],
  ["NZ$", ["NZD"]],
  ["NT$", ["TWD"]],
  ["S$", ["SGD"]],
  ["A$", ["AUD"]],
  ["C$", ["CAD"]],
  ["R$", ["BRL"]],
  ["Rp", ["IDR"]],
  ["RM", ["MYR"]],
  ["$", DOLLARS],
  ["€", ["EUR"]],
  ["£", ["GBP"]],
  ["¥", ["JPY", "CNY"]],
  ["₹", ["INR"]],
  ["₪", ["ILS"]],
  ["฿", ["THB"]],
  ["₩", ["KRW"]],
  ["₱", ["PHP"]],
  ["₫", ["VND"]],
];

const CODES: Record<string, string> = Object.fromEntries(
  [
    "USD", "EUR", "GBP", "JPY", "CNY", "INR", "ILS", "SGD", "HKD", "AUD", "CAD", "NZD",
    "THB", "KRW", "PHP", "VND", "IDR", "MYR", "TWD", "CHF", "SEK", "NOK", "DKK", "BRL",
    "MXN", "AED", "SAR", "ZAR", "PLN", "CZK", "TRY",
  ].map((c) => [c, c]),
);
CODES.RMB = "CNY";
CODES.NIS = "ILS";

const WORDS: Record<string, string[]> = {
  dollars: DOLLARS,
  dollar: DOLLARS,
  euros: ["EUR"],
  euro: ["EUR"],
  pounds: ["GBP"],
  rupees: ["INR"],
  baht: ["THB"],
  yen: ["JPY"],
  shekels: ["ILS"],
  ringgit: ["MYR"],
  pesos: ["PHP", "MXN"],
  yuan: ["CNY"],
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// 1,200.50 · 1.200,50 · 1 200 (non-breaking or thin space only) · 1200 · 12.5
const NUM = String.raw`\d{1,3}(?:[,.\u00a0\u202f\u2009]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const SCALE = String.raw`(?:\s?(?:k|K|M|m|mn|bn|million|thousand)(?![\p{L}\p{N}]))?`;
const SYM = SYMBOLS.map(([s]) => esc(s)).join("|");
const CODE = Object.keys(CODES).join("|");
const WORD = Object.keys(WORDS).join("|");

// Case-insensitive pieces without the "i" flag, so currency codes stay upper-case only.
const ci = (s: string) => s.replace(/[a-z]/g, (c) => `[${c}${c.toUpperCase()}]`);

const PRICE_WORDS = ci(String.raw`prices?|priced at|pricing|costs?|fee|fees|quoted?|quoted at`);
const UNIT_NOUN = ci(String.raw`seat|user|month|mo|year|yr|licen(?:c|s)e|unit|head|person|annum|day|hour|hr`);
const PER_UNIT = String.raw`(?:\s?\/\s?|\s+${ci("per")}\s+|\s+${ci("a")}\s+)(?:${UNIT_NOUN})(?![\p{L}])|\s+${ci("each")}\b`;
// Numbers that count things, not money ("price for 30 seats", "pay within 30 days").
const COUNT_NOUN = ci(String.raw`days?|weeks?|months?|years?|hours?|minutes?|seats?|users?|licen(?:c|s)es?|units?|people|persons?|percent|pct|x|times`);

// Order of alternatives: symbol or code before the number, then code, symbol or word after it,
// then a bare number in a clear price context ("price 40", "40 per seat", "40/mo").
const MONEY_RE = new RegExp(
  [
    String.raw`(?<pre>(?<![\p{L}])(?:${SYM})|\b(?:${CODE})\b)\s?(?<n1>${NUM})(?<s1>${SCALE})`,
    String.raw`(?<![\p{L}\p{N}.,])(?<n2>${NUM})(?<s2>${SCALE})\s?(?<post>(?:${CODE})\b|[€£₹₪฿₩₫]|\b(?:${ci(WORD)})\b)`,
    String.raw`(?<=\b(?:${PRICE_WORDS})\b[^\p{N}\n]{0,12})(?<![\p{N}.,])(?<n3>${NUM})(?<s3>${SCALE})(?![\p{N}%])(?!\s?(?:${COUNT_NOUN})\b)`,
    String.raw`(?<![\p{L}\p{N}.,])(?<n4>${NUM})(?<s4>${SCALE})(?=${PER_UNIT})`,
  ].join("|"),
  "gu",
);

export function parseNumber(input: string): number {
  let s = input.replace(/[\u00a0\u202f\u2009 ]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const dec = lastComma > lastDot ? "," : ".";
    const thou = dec === "," ? "." : ",";
    s = s.split(thou).join("").replace(dec, ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    // One separator followed by exactly three digits is read as thousands ("1,200", "1.200").
    s = parts.length > 2 || parts[1]?.length === 3 ? parts.join("") : parts.join(".");
  }
  return Number(s);
}

function scale(suffix: string | undefined): number {
  const s = (suffix ?? "").trim();
  if (s === "k" || s === "K" || s === "thousand") return 1e3;
  if (s === "M" || s === "m" || s === "mn" || s === "million") return 1e6;
  if (s === "bn") return 1e9;
  return 1;
}

function currenciesFor(token: string | undefined): string[] {
  if (!token) return [];
  const sym = SYMBOLS.find(([s]) => s === token);
  if (sym) return sym[1];
  const code = CODES[token];
  if (code) return [code];
  return WORDS[token.toLowerCase()] ?? [];
}

export function findAmounts(text: string): MoneyAmount[] {
  const out: MoneyAmount[] = [];
  for (const m of text.matchAll(MONEY_RE)) {
    const g = m.groups ?? {};
    const num = g.n1 ?? g.n2 ?? g.n3 ?? g.n4;
    if (num === undefined) continue;
    const value = parseNumber(num) * scale(g.s1 ?? g.s2 ?? g.s3 ?? g.s4);
    if (!Number.isFinite(value)) continue;
    out.push({ raw: m[0].trim(), value, currencies: currenciesFor(g.pre ?? g.post), index: m.index ?? 0 });
  }
  return out;
}

// Read a spreadsheet cell as a price: "$1,200", "1.200,00 €", "1200", "50 / month".
export function parsePriceCell(cell: string): { value: number; currencies: string[] } | null {
  const found = findAmounts(cell)[0];
  if (found) return { value: found.value, currencies: found.currencies };
  const m = cell.match(new RegExp(`(?<![\\p{N}.,])(${NUM})(${SCALE})`, "u"));
  if (!m?.[1]) return null;
  const value = parseNumber(m[1]) * scale(m[2]);
  return Number.isFinite(value) ? { value, currencies: currencyMentioned(cell) } : null;
}

// Any currency named anywhere in a string, e.g. a header like "Price (USD)" or a cell "USD".
export function currencyMentioned(text: string): string[] {
  for (const [s, codes] of SYMBOLS) if (text.includes(s) && s !== "RM" && s !== "Rp") return codes;
  const code = text.match(new RegExp(`\\b(${CODE})\\b`))?.[1];
  return code ? currenciesFor(code) : [];
}

export function currenciesCompatible(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((c) => b.includes(c));
}
