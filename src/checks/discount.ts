// discount.check: every discount or freebie in the body is declared, and none goes past
// the allowed maximum or pushes a price below its floor. Pure.

import type { CheckResult } from "./pricing.js";
import { matchItem, type RateCard } from "./rate-card.js";

export interface DeclaredDiscount {
  // The rate card item it applies to. Leave out for a discount on the whole deal.
  item?: string;
  // 100 for something given free (a free month, a waived fee).
  percent: number;
}

export interface DiscountRules {
  // Highest discount allowed when the rate card has no max discount for the item, in percent.
  maxPercent?: number;
}

export interface FoundDiscount {
  raw: string;
  // null when the text gives something away free rather than a percent.
  percent: number | null;
}

const PCT = String.raw`(\d+(?:[.,]\d+)?)\s?(?:%|percent\b|pct\b)`;
const PERCENT_RES = [
  new RegExp(String.raw`${PCT}\s?(?:off|discount|reduction|rebate|cheaper|savings?)\b`, "gi"),
  new RegExp(String.raw`\b(?:discount(?:ed)?|reduction|rebate|off|knock(?:ed)? off)\b[^.\n%]{0,30}?${PCT}`, "gi"),
];
const FREE_RE = new RegExp(
  [
    String.raw`\bfor free\b`,
    String.raw`\bfree (?:of charge|months?|weeks?|years?|trial|onboarding|setup|set-up|implementation|upgrade|seats?|licen[cs]es?|training|support|users?|add-?ons?)\b`,
    String.raw`\b(?:first|one|two|three|\d+) (?:months?|weeks?|years?|seats?|licen[cs]es?) (?:free|on us|on the house|at no (?:extra |additional )?cost)\b`,
    String.raw`\b(?:months?|weeks?|years?|seats?|licen[cs]es?|setup|set-up|onboarding|implementation|training|support|fees?|users?|add-?ons?) (?:is|are|will be|would be|comes?|come) (?:free|on us|on the house|at no (?:extra |additional )?cost)\b`,
    String.raw`\bwaiv(?:e|ed|es|ing)\b`,
    String.raw`\bcomplimentary\b`,
    String.raw`\bno (?:extra |additional )?charge\b`,
    String.raw`\bat no (?:extra |additional )?cost\b`,
    String.raw`\bon the house\b`,
    String.raw`\bthrow(?:ing)? in\b`,
  ].join("|"),
  "gi",
);

export function findDiscounts(text: string): FoundDiscount[] {
  const found: (FoundDiscount & { index: number })[] = [];
  const seen = new Set<number>();
  for (const re of PERCENT_RES) {
    for (const m of text.matchAll(re)) {
      const percent = Number((m[1] ?? "").replace(",", "."));
      // One "20%" can match both patterns; count it once.
      const at = (m.index ?? 0) + m[0].indexOf(m[1] ?? "");
      if (seen.has(at)) continue;
      seen.add(at);
      found.push({ raw: m[0].trim(), percent, index: m.index ?? 0 });
    }
  }
  for (const m of text.matchAll(FREE_RE)) found.push({ raw: m[0].trim(), percent: null, index: m.index ?? 0 });
  return found.sort((a, b) => a.index - b.index).map(({ raw, percent }) => ({ raw, percent }));
}

export function discountCheck(input: {
  body: string;
  discounts: DeclaredDiscount[];
  card: RateCard | null;
  rules: DiscountRules;
}): CheckResult {
  const reasons: string[] = [];
  const declared = input.discounts;

  for (const f of findDiscounts(input.body)) {
    const ok = f.percent === null ? declared.some((d) => d.percent >= 100) : declared.some((d) => Math.abs(d.percent - (f.percent ?? 0)) < 0.01);
    if (!ok) {
      const what = f.percent === null ? "gives something free" : `offers ${f.percent}% off`;
      reasons.push(`The body ${what} ("${f.raw}") but no matching discount is declared. Declare it in discounts (percent ${f.percent ?? 100}), or take it out.`);
    }
  }

  for (const d of declared) {
    const label = `${d.percent}% off${d.item ? ` "${d.item}"` : ""}`;
    if (!(d.percent > 0 && d.percent <= 100)) {
      reasons.push(`${label}: a discount must be more than 0% and at most 100%.`);
      continue;
    }
    let limit = input.rules.maxPercent;
    let limitFrom = "your max discount setting";
    if (d.item) {
      if (!input.card) {
        reasons.push(`${label}: no rate card could be read, so the discount can't be checked.`);
        continue;
      }
      const match = matchItem(input.card, d.item);
      if ("error" in match) {
        reasons.push(`${label}: ${match.error}`);
        continue;
      }
      const cardMax = match.rows.map((r) => r.maxDiscount).filter((m): m is number => m !== undefined);
      if (cardMax.length > 0) {
        limit = Math.min(...cardMax) * 100;
        limitFrom = `the rate card (${match.rows[0]?.where})`;
      }
      // The discounted list price must still clear the floor.
      for (const r of match.rows) {
        if (r.list === undefined || r.floorFrom !== "floor") continue;
        const after = r.list * (1 - d.percent / 100);
        if (after + 0.005 < r.floor) {
          reasons.push(`${label}: list ${r.list} minus ${d.percent}% is ${round2(after)}, below the floor of ${r.floor} (${r.where}).`);
          break;
        }
      }
    }
    if (limit === undefined) {
      reasons.push(`${label}: no discount limit is set. Add a max discount column to the rate card or set a max discount in config.`);
    } else if (d.percent > limit + 1e-9) {
      reasons.push(`${label} is more than the ${round2(limit)}% allowed by ${limitFrom}.`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}

const round2 = (n: number) => Math.round(n * 100) / 100;
