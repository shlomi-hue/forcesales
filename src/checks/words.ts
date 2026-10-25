// words.check: no banned words or phrases, and no unfilled placeholders. Pure.

import type { CheckResult } from "./pricing.js";

// Risky promises a salesperson shouldn't put in writing. The "never say" list in company/voice.md adds to these.
export const DEFAULT_BANNED = [
  "guarantee",
  "guaranteed",
  "guarantees",
  "risk-free",
  "risk free",
  "no risk",
  "lifetime deal",
  "best price",
  "lowest price",
  "final offer",
  "legally binding",
];

const PLACEHOLDER_RES: RegExp[] = [
  /\[[A-Z][\w ]{0,30}\]/g,
  /\[(?:insert[^\]]*|tbd|todo|x+)\]/gi,
  /\{\{[^}]*\}\}/g,
  /<(?:insert|name|company|first ?name|date|price)[^>]*>/gi,
  /\b(?:TODO|TBD|FIXME|XXX|lorem ipsum)\b/g,
];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function wordsCheck(input: { body: string; subject?: string; banned: string[] }): CheckResult {
  const text = `${input.subject ?? ""}\n${input.body}`;
  const reasons: string[] = [];
  for (const phrase of input.banned) {
    const p = phrase.trim();
    if (!p) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])${esc(p).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu");
    const m = text.match(re);
    if (m) reasons.push(`Uses "${m[0]}", which is on the banned list.`);
  }
  for (const re of PLACEHOLDER_RES) {
    for (const m of text.matchAll(re)) reasons.push(`Has an unfilled placeholder: "${m[0]}".`);
  }
  const unique = [...new Set(reasons)];
  return { ok: unique.length === 0, reasons: unique };
}
