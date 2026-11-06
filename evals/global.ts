// Clears old results before a run, and writes evals/score.md after it.

import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS, type SetResult } from "./lib/score.js";

export const SETS = ["threads", "outcomes", "calibration", "promises", "edits", "injection"];

export function setup(): void {
  rmSync(RESULTS, { recursive: true, force: true });
}

export function scoreMarkdown(results: SetResult[], when: string): string {
  const byName = new Map(results.map((r) => [r.set, r]));
  const lines = [
    "# Eval scores",
    "",
    `Run ${when} with \`npm run eval\`. Agent parts need \`EVAL_AGENT=1\` and Claude Code's \`claude\` command; model: ${process.env.EVAL_MODEL ?? "Claude Code's default"}.`,
    "",
    "| Set | Passed | Key numbers | Notes |",
    "|---|---|---|---|",
  ];
  for (const name of SETS) {
    const r = byName.get(name);
    if (!r) {
      lines.push(`| ${name} | not run | | |`);
      continue;
    }
    const metrics = Object.entries(r.metrics).map(([k, v]) => `${k}: ${v}`).join(" · ");
    lines.push(`| ${name} | ${r.passed}/${r.cases} | ${metrics} | ${r.skipped ?? ""} |`);
  }
  for (const name of SETS) {
    const r = byName.get(name);
    if (!r) continue;
    lines.push("", `## ${name}`, "", r.about, "");
    lines.push(...(r.failures.length ? r.failures.map((f) => `- ${f.replace(/\n/g, " ")}`) : ["No misses."]));
  }
  return `${lines.join("\n")}\n`;
}

export function teardown(): void {
  if (!existsSync(RESULTS)) return;
  const results = readdirSync(RESULTS)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(RESULTS, f), "utf8")) as SetResult);
  writeFileSync(join("evals", "score.md"), scoreMarkdown(results, new Date().toISOString().slice(0, 16).replace("T", " ")));
  process.stdout.write(`\nWrote evals/score.md (${results.length} set(s)).\n`);
}
