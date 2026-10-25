import { describe, expect, it } from "vitest";
import { parseRateCard } from "../../src/checks/rate-card.js";
import * as f from "./fixtures.js";

describe("parseRateCard", () => {
  it("reads a plain layout with a floor column", () => {
    const card = parseRateCard(f.simple);
    expect(card.rows).toHaveLength(3);
    const pro = card.rows[0];
    expect(pro).toMatchObject({ display: "PRO-1", floor: 50, floorFrom: "floor", currencies: ["USD"], where: "'Rate card'!D2" });
    expect(pro?.names).toEqual(["pro 1", "pro"]);
  });

  it("uses list prices as floors when there's no floor column, one row per price column", () => {
    const card = parseRateCard(f.monthlyAnnual);
    expect(card.rows.map((r) => [r.display, r.floor, r.floorFrom])).toEqual([
      ["Starter", 30, "list"],
      ["Starter", 300, "list"],
      ["Growth", 80, "list"],
      ["Growth", 800, "list"],
    ]);
    expect(card.rows[1]?.labels).toContain("annual");
  });

  it("finds a header below title rows and carries the item name into tier rows", () => {
    const card = parseRateCard(f.tiered);
    expect(card.rows.map((r) => [r.display, r.minQty, r.maxQty, r.floor])).toEqual([
      ["Platform", 1, 10, 45],
      ["Platform", 11, 50, 40],
      ["Platform", 51, undefined, 35],
    ]);
    expect(card.rows[0]?.currencies).toEqual(["SGD"]);
  });

  it("takes list price minus max discount as the floor", () => {
    expect(parseRateCard(f.withDiscount).rows[0]).toMatchObject({ floor: 8000, floorFrom: "list-discount" });
  });

  it("reads European number format and an unlabelled item column", () => {
    expect(parseRateCard(f.european).rows[0]).toMatchObject({ display: "Lizenz", floor: 1000, currencies: ["EUR"] });
  });

  it("keeps the same item on several tabs apart by currency", () => {
    const card = parseRateCard(f.perCurrencyTabs);
    expect(card.rows.map((r) => [r.floor, r.currencies])).toEqual([
      [50, ["USD"]],
      [65, ["SGD"]],
    ]);
  });

  it("accepts explicit column names for headers it can't guess", () => {
    expect(parseRateCard(f.oddHeaders).rows).toHaveLength(0);
    const card = parseRateCard(f.oddHeaders, { name: "Thing", list: "Ask", floor: "Num" });
    expect(card.rows[0]).toMatchObject({ display: "Widget", floor: 70 });
  });

  it("warns about tabs with no prices", () => {
    const card = parseRateCard(f.noPrices);
    expect(card.rows).toHaveLength(0);
    expect(card.warnings[0]).toMatch(/Notes/);
  });
});
