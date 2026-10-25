import { describe, expect, it } from "vitest";
import { discountCheck, findDiscounts } from "../../src/checks/discount.js";
import { parseRateCard } from "../../src/checks/rate-card.js";
import { simple, withDiscount } from "./fixtures.js";

const card = parseRateCard(simple);
const rules = { maxPercent: 15 };

describe("findDiscounts", () => {
  it("finds percent discounts in several phrasings", () => {
    expect(findDiscounts("10% off, a 12.5 percent discount, discounted by 8%, knocked off 5%").map((d) => d.percent)).toEqual([10, 12.5, 8, 5]);
  });

  it("finds freebies", () => {
    expect(findDiscounts("first month free, and we'll waive the setup fee. Free onboarding too.").map((d) => d.raw)).toEqual([
      "first month free",
      "waive",
      "Free onboarding",
    ]);
  });

  it("finds 'X is free' phrasings", () => {
    expect(findDiscounts("Your first year is free and onboarding is on us.").map((d) => d.raw)).toEqual(["year is free", "onboarding is on us"]);
  });

  it("ignores percents that aren't discounts and everyday 'free'", () => {
    expect(findDiscounts("Usage grew 40% and 20% less time. Feel free to call; I'm free Tuesday.")).toEqual([]);
  });
});

describe("discountCheck", () => {
  it("passes a declared discount within the limit", () => {
    expect(discountCheck({ body: "We can do 10% off.", discounts: [{ percent: 10 }], card, rules })).toEqual({ ok: true, reasons: [] });
  });

  it("passes a declared freebie the rate card allows", () => {
    const allCard = parseRateCard([{ title: "x", rows: [["Item", "Price", "Max discount"], ["Setup", "500", "100%"]] }]);
    expect(discountCheck({ body: "We'll waive setup.", discounts: [{ item: "Setup", percent: 100 }], card: allCard, rules }).ok).toBe(true);
  });

  it("refuses an undeclared discount or freebie", () => {
    const r = discountCheck({ body: "20% off, plus the first month free.", discounts: [], card, rules });
    expect(r.reasons).toHaveLength(2);
    expect(r.reasons[0]).toContain("offers 20% off");
    expect(r.reasons[1]).toContain("gives something free");
  });

  it("refuses a discount over the global limit", () => {
    expect(discountCheck({ body: "20% off", discounts: [{ percent: 20 }], card, rules }).reasons[0]).toContain("more than the 15% allowed by your max discount setting");
  });

  it("uses the rate card's max discount for an item", () => {
    const c = parseRateCard(withDiscount);
    expect(discountCheck({ body: "18% off the audit", discounts: [{ item: "Audit", percent: 18 }], card: c, rules }).ok).toBe(true);
    expect(discountCheck({ body: "25% off the audit", discounts: [{ item: "Audit", percent: 25 }], card: c, rules }).reasons[0]).toMatch(/more than the 20% allowed by the rate card/);
  });

  it("refuses a discount that pushes list price below the floor", () => {
    // Pro: list 60, floor 50. 15% off 60 = 51 is fine; 20% would be 48 (and over the limit too).
    expect(discountCheck({ body: "15% off", discounts: [{ item: "Pro", percent: 15 }], card, rules }).ok).toBe(true);
    const r = discountCheck({ body: "20% off", discounts: [{ item: "Pro", percent: 20 }], card, rules: { maxPercent: 50 } });
    expect(r.reasons[0]).toContain("list 60 minus 20% is 48, below the floor of 50");
  });

  it("refuses any discount when no limit is set anywhere", () => {
    expect(discountCheck({ body: "5% off", discounts: [{ percent: 5 }], card, rules: {} }).reasons[0]).toContain("no discount limit is set");
  });
});
