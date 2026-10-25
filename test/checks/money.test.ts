import { describe, expect, it } from "vitest";
import { findAmounts, parseNumber, parsePriceCell } from "../../src/checks/money.js";

const values = (t: string) => findAmounts(t).map((a) => a.value);

describe("parseNumber", () => {
  it.each([
    ["1200", 1200],
    ["1,200", 1200],
    ["1.200", 1200],
    ["1,200.50", 1200.5],
    ["1.200,50", 1200.5],
    ["12.5", 12.5],
    ["12,5", 12.5],
    ["1.500.000", 1500000],
  ])("%s -> %d", (s, n) => expect(parseNumber(s)).toBe(n));
});

describe("findAmounts", () => {
  it("finds symbols, codes and words before or after the number", () => {
    expect(values("$1,200 per year, or USD 99, or 99 EUR, or 50 dollars, or 1.200,50 €")).toEqual([1200, 99, 99, 50, 1200.5]);
  });

  it("reads k and M suffixes", () => {
    expect(values("S$5k a month and $1.2M total")).toEqual([5000, 1_200_000]);
  });

  it("knows regional symbols", () => {
    const [sgd, rm, rp] = findAmounts("S$40, RM 400, Rp 1.500.000");
    expect(sgd?.currencies).toEqual(["SGD"]);
    expect(rm?.currencies).toEqual(["MYR"]);
    expect(rp?.value).toBe(1_500_000);
  });

  it("catches bare numbers in a price context", () => {
    expect(values("Price: 40 per seat")).toEqual([40]);
    expect(values("it costs 12.5/mo")).toEqual([12.5]);
  });

  it("ignores counts, dates and percentages", () => {
    expect(values("price for 30 seats, pay within 30 days, 20% off, meet 2026-10-02 at 3pm, we have 3 users")).toEqual([]);
  });
});

describe("parsePriceCell", () => {
  it("reads formatted and plain cells", () => {
    expect(parsePriceCell("$1,200.00")?.value).toBe(1200);
    expect(parsePriceCell("1200")).toEqual({ value: 1200, currencies: [] });
    expect(parsePriceCell("50 / month")?.value).toBe(50);
    expect(parsePriceCell("Contact us")).toBeNull();
  });
});
