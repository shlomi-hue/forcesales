// Each eval set records its result here; the global teardown turns them into evals/score.md.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const RESULTS = join("evals", "results");

export interface SetResult {
  set: string;
  // What the set measures, one line.
  about: string;
  cases: number;
  passed: number;
  // Named numbers worth tracking, e.g. { "signal recall": 0.9 }.
  metrics: Record<string, number | string>;
  failures: string[];
  // Set when part of the set didn't run, and why.
  skipped?: string;
}

export function record(r: SetResult): void {
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${r.set}.json`), `${JSON.stringify(r, null, 2)}\n`);
}

export const ratio = (num: number, den: number) => (den === 0 ? "-" : `${Math.round((num / den) * 100)}% (${num}/${den})`);
