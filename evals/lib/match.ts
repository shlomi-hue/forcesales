// Loose matching of what the agent wrote against gold answers.

import { normPhrase } from "../../src/learn/diff.js";

const tokens = (s: string) => normPhrase(s).replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);

// Same quote if one contains the other, or most of the gold words are there.
export function sameQuote(gold: string, got: string): boolean {
  const g = normPhrase(gold);
  const h = normPhrase(got);
  if (!g || !h) return false;
  if (g.includes(h) && h.length >= g.length * 0.5) return true;
  if (h.includes(g)) return true;
  const gt = tokens(gold);
  const ht = new Set(tokens(got));
  return gt.filter((t) => ht.has(t)).length / gt.length >= 0.7;
}

export const mentions = (text: string, phrase: string) => normPhrase(text).includes(normPhrase(phrase));
