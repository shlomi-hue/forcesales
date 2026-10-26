import { describe, expect, it } from "vitest";
import { parsePipeline, toIsoDate } from "../../src/pipeline/deals.js";

describe("deals sheet", () => {
  it("reads a typical layout, with dates and numbers from raw values", () => {
    const formatted = [{ title: "Pipeline", rows: [["Company", "Deal value", "Stage", "Expected close", "Probability"], ["Acme", "$48,000", "Proposal", "11/12/2026", "40%"], ["Beta", "S$20,000", "Closed won", "1/10/2026", ""], ["Gamma", "$9,000", "Lost", "", ""]] }];
    const raw = [{ title: "Pipeline", rows: [["Company", "Deal value", "Stage", "Expected close", "Probability"], ["Acme", "48000", "Proposal", "46338", "0.4"], ["Beta", "20000", "Closed won", "46297", ""], ["Gamma", "9000", "Lost", "", ""]] }];
    const { deals, warnings } = parsePipeline(formatted, raw);
    expect(warnings).toEqual([]);
    expect(deals.map((d) => [d.account, d.value, d.currency[0], d.status, d.close, d.sheetProbability])).toEqual([
      ["Acme", 48000, "USD", "open", "2026-11-12", 0.4],
      ["Beta", 20000, "SGD", "won", "2026-10-02", undefined],
      ["Gamma", 9000, "USD", "lost", undefined, undefined],
    ]);
  });

  it("finds the header below a title, takes a currency column, and accepts named columns", () => {
    const tab = { title: "Q4", rows: [["Q4 deals"], ["Client", "ACV", "Currency", "Status"], ["Delta", "12000", "EUR", "Negotiation"]] };
    expect(parsePipeline([tab], [tab]).deals[0]).toMatchObject({ account: "Delta", value: 12000, currency: ["EUR"], status: "open" });
    const odd = { title: "x", rows: [["Who", "How much", "When"], ["Echo", "5000", "2026-12-01"]] };
    expect(parsePipeline([odd], [odd]).deals).toEqual([]);
    expect(parsePipeline([odd], [odd], { account: "Who", value: "How much", close: "When" }).deals[0]).toMatchObject({ account: "Echo", value: 5000, close: "2026-12-01" });
  });

  it("never guesses ambiguous date strings", () => {
    expect(toIsoDate("46338")).toBe("2026-11-12");
    expect(toIsoDate("2026-11-12")).toBe("2026-11-12");
    expect(toIsoDate("Nov 12, 2026")).toBe("2026-11-12");
    expect(toIsoDate("11/12/2026")).toBeUndefined();
  });
});
