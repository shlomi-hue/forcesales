import { describe, expect, it } from "vitest";
import { pricingCheck } from "../../src/checks/pricing.js";
import { parseRateCard } from "../../src/checks/rate-card.js";
import * as f from "./fixtures.js";

const simple = parseRateCard(f.simple);

describe("pricingCheck passes", () => {
  it("a draft with no prices, even without a rate card", () => {
    expect(pricingCheck({ body: "Thanks, talk Tuesday.", prices: [], card: null })).toEqual({ ok: true, reasons: [] });
  });

  it("a price at or above the floor", () => {
    const r = pricingCheck({ body: "Pro is $55 per seat.", prices: [{ item: "Pro", unit_price: 55 }], card: simple });
    expect(r).toEqual({ ok: true, reasons: [] });
    expect(pricingCheck({ body: "Pro is $50.", prices: [{ item: "pro-1", unit_price: 50 }], card: simple }).ok).toBe(true);
  });

  it("line totals and the grand total in the body", () => {
    const body = "Pro: 10 seats at $55 = $550. Onboarding $1,500. Total $2,050.";
    const prices = [
      { item: "Pro", unit_price: 55, quantity: 10 },
      { item: "Onboarding", unit_price: 1500, quantity: 1 },
    ];
    expect(pricingCheck({ body, prices, card: simple })).toEqual({ ok: true, reasons: [] });
  });

  it("the right volume tier when quantity is given", () => {
    const card = parseRateCard(f.tiered);
    expect(pricingCheck({ body: "S$36 per seat", prices: [{ item: "Platform", unit_price: 36, quantity: 60 }], card }).ok).toBe(true);
  });

  it("the right variant when named", () => {
    const card = parseRateCard(f.monthlyAnnual);
    expect(pricingCheck({ body: "Starter is $300 a year", prices: [{ item: "Starter", unit_price: 300, variant: "annual" }], card }).ok).toBe(true);
  });

  it("the tab whose currency matches the body", () => {
    const card = parseRateCard(f.perCurrencyTabs);
    expect(pricingCheck({ body: "US$55 per seat", prices: [{ item: "Pro", unit_price: 55 }], card }).ok).toBe(true);
  });
});

describe("pricingCheck refuses", () => {
  it("a price below the floor, saying where the floor is", () => {
    const r = pricingCheck({ body: "Pro is $40 per seat.", prices: [{ item: "Pro", unit_price: 40 }], card: simple });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain("below the rate card floor of 50 USD");
    expect(r.reasons[0]).toContain("'Rate card'!D2");
  });

  it("a money amount in the body that wasn't declared", () => {
    const r = pricingCheck({ body: "Pro is $55, or $30 if you sign today.", prices: [{ item: "Pro", unit_price: 55 }], card: simple });
    expect(r.ok).toBe(false);
    expect(r.reasons).toHaveLength(1);
    expect(r.reasons[0]).toContain('"$30"');
  });

  it("prices in the body with nothing declared", () => {
    expect(pricingCheck({ body: "We can do 40 per seat.", prices: [], card: simple }).ok).toBe(false);
  });

  it("an item that isn't in the rate card", () => {
    const r = pricingCheck({ body: "$10", prices: [{ item: "Gold", unit_price: 10 }], card: simple });
    expect(r.reasons[0]).toMatch(/no item called "Gold".*Known items: PRO-1, ENT-1, SETUP/);
  });

  it("any price when the rate card can't be read", () => {
    const r = pricingCheck({ body: "$55", prices: [{ item: "Pro", unit_price: 55 }], card: parseRateCard(f.noPrices) });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toMatch(/no rate card could be read/);
  });

  it("a currency the rate card doesn't use for that item", () => {
    const r = pricingCheck({ body: "€55", prices: [{ item: "Pro", unit_price: 55 }], card: simple });
    expect(r.reasons[0]).toMatch(/prices this item in USD, not EUR/);
  });

  it("a price below the floor of the tier for its quantity", () => {
    const card = parseRateCard(f.tiered);
    const r = pricingCheck({ body: "S$38 per seat", prices: [{ item: "Platform", unit_price: 38, quantity: 20 }], card });
    expect(r.reasons[0]).toContain("below the rate card floor of 40 SGD");
  });

  it("a tiered price with no quantity that only a bigger tier allows", () => {
    const card = parseRateCard(f.tiered);
    const r = pricingCheck({ body: "S$38 per seat", prices: [{ item: "Platform", unit_price: 38 }], card });
    expect(r.reasons[0]).toMatch(/Give the quantity/);
  });

  it("a price that's only valid for another variant", () => {
    const card = parseRateCard(f.monthlyAnnual);
    const r = pricingCheck({ body: "Starter is $250", prices: [{ item: "Starter", unit_price: 250, variant: "annual" }], card });
    expect(r.reasons[0]).toContain("below the rate card floor of 300");
  });

  it("a price below list minus max discount", () => {
    const card = parseRateCard(f.withDiscount);
    const r = pricingCheck({ body: "The audit is $7,500.", prices: [{ item: "Audit", unit_price: 7500 }], card });
    expect(r.reasons[0]).toMatch(/below the rate card floor of 8000.*list price minus max discount/);
  });

  it("a k-suffixed undeclared amount", () => {
    const r = pricingCheck({ body: "Pro is $55, total around $5k.", prices: [{ item: "Pro", unit_price: 55 }], card: simple });
    expect(r.reasons[0]).toContain('"$5k"');
  });
});
