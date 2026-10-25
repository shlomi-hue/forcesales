import { defineConfig } from "vitest/config";

// Evals run with `npm run eval`; `npm run eval -- injection` runs one set.
export default defineConfig({
  test: { include: ["evals/**/*.eval.ts"], root: "." },
});
