import { describe, expect, it } from "vitest";
import { quoteCheck } from "../../src/checks/quote.js";

const source = "Hi,\n  We have Q1   money set aside for this. Our CFO’s main worry is the rollout — it has to be done by March.";

describe("quoteCheck", () => {
  it("finds a verbatim quote, ignoring spacing, curly quotes and dash style", () => {
    expect(quoteCheck("we have Q1 money set aside".replace("we", "We"), source)).toBe(true);
    expect(quoteCheck("Our CFO's main worry is the rollout - it has to be done by March", source)).toBe(true);
    expect(quoteCheck('"We have Q1 money set aside"', source)).toBe(true);
  });

  it("allows ... between pieces that appear in order", () => {
    expect(quoteCheck("We have Q1 money ... done by March", source)).toBe(true);
    expect(quoteCheck("done by March ... We have Q1 money", source)).toBe(false);
  });

  it("refuses paraphrases, changed words and empty quotes", () => {
    expect(quoteCheck("we have money set aside", source)).toBe(false);
    expect(quoteCheck("We have Q2 money set aside", source)).toBe(false);
    expect(quoteCheck("", source)).toBe(false);
    expect(quoteCheck("...", source)).toBe(false);
  });
});
