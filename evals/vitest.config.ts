import { defineConfig } from "vitest/config";

// Evals run with `npm run eval`; `npm run eval -- injection` runs one set. Scores go to evals/score.md.
// Agent sets run Claude Code for real: set EVAL_AGENT=1 to include them.
export default defineConfig({
  test: {
    include: ["evals/**/*.eval.ts"],
    root: ".",
    globalSetup: ["evals/global.ts"],
    testTimeout: 600_000,
    hookTimeout: 600_000,
  },
});
