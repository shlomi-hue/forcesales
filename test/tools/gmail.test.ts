import { describe, expect, it } from "vitest";
import { parseRateCard } from "../../src/checks/rate-card.js";
import { createDraft, readThread, searchThreads } from "../../src/tools/gmail.js";
import { simple } from "../checks/fixtures.js";
import { decodeRaw, fakeGmail, rules } from "./fake-google.js";

const card = parseRateCard(simple);

describe("gmail read", () => {
  it("returns a thread's text inside one data block, attachments and HTML stripped", async () => {
    const { gmail } = fakeGmail();
    const out = await readThread(gmail, "t-123");
    expect(out).toMatch(/^<<<OUTSIDE_DATA id=[0-9a-f]{8} source="gmail\/thread\/t-123">>>/);
    expect(out).toContain("What would Pro cost us for 10 seats?");
    expect(out).toContain("Also & one more thing:\nbudget is tight.");
    expect(out).not.toContain("<div>");
    expect(out).not.toContain("quote.pdf");
    // A fake end marker inside the email can't close the block early.
    expect(out.match(/<<<END_OUTSIDE_DATA/g)).toHaveLength(1);
    expect(out.trimEnd()).toMatch(/<<<END_OUTSIDE_DATA id=[0-9a-f]{8}>>>$/);
  });

  it("lists search results with ids and subjects", async () => {
    const { gmail } = fakeGmail();
    const out = await searchThreads(gmail, "from:dana", 10);
    expect(out).toContain("thread_id: t-123");
    expect(out).toContain("subject: Re: Pricing for Pro");
  });
});

describe("gmail draft", () => {
  it("replies on the thread with threading headers and default recipient", async () => {
    const { gmail, drafts } = fakeGmail();
    const result = await createDraft(
      { gmail, loadRateCard: async () => card, rules: async () => rules, internalIds: ["RATECARD-SHEET-ID-123"] },
      { thread_id: "t-123", body: "Hi Dana,\nPro is $55 per seat, so $550 for 10.\nShlomi", prices: [{ item: "Pro", unit_price: 55, quantity: 10 }], discounts: [] },
    );
    expect(result).toMatchObject({ created: true, draftId: "d-1", to: ["Dana Lee <dana@acme.example>"] });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.message?.threadId).toBe("t-123");
    const { headers, body } = decodeRaw(drafts[0]?.message?.raw ?? "");
    expect(headers).toContain("To: Dana Lee <dana@acme.example>");
    expect(headers).toContain("Subject: Re: Pricing for Pro");
    expect(headers).toContain("In-Reply-To: <m2@acme.example>");
    expect(headers).toContain("References: <m1@acme.example> <m2@acme.example>");
    expect(body).toBe("Hi Dana,\r\nPro is $55 per seat, so $550 for 10.\r\nShlomi");
  });

  it("refuses a below-floor price and creates nothing", async () => {
    const { gmail, drafts } = fakeGmail();
    const result = await createDraft(
      { gmail, loadRateCard: async () => card, rules: async () => rules, internalIds: ["RATECARD-SHEET-ID-123"] },
      { thread_id: "t-123", body: "Pro is $40 per seat.", prices: [{ item: "Pro", unit_price: 40 }], discounts: [] },
    );
    expect(result.created).toBe(false);
    if (!result.created) expect(result.reasons[0]).toContain("[pricing]");
    if (!result.created) expect(result.reasons[0]).toContain("below the rate card floor of 50 USD");
    expect(drafts).toHaveLength(0);
  });

  it("refuses an undeclared price, and a price when no rate card is set up", async () => {
    const { gmail, drafts } = fakeGmail({ sentTo: ["a@b.example"] });
    const undeclared = await createDraft({ gmail, loadRateCard: async () => card, rules: async () => rules, internalIds: ["RATECARD-SHEET-ID-123"] }, { to: ["a@b.example"], subject: "Hi", body: "Only $30!", prices: [], discounts: [] });
    const noCard = await createDraft({ gmail, loadRateCard: async () => null, rules: async () => rules, internalIds: [] }, { to: ["a@b.example"], subject: "Hi", body: "Pro is $55", prices: [{ item: "Pro", unit_price: 55 }], discounts: [] });
    expect(undeclared.created).toBe(false);
    expect(noCard.created).toBe(false);
    expect(drafts).toHaveLength(0);
  });

  it("doesn't load the rate card for a draft with no prices", async () => {
    const { gmail, drafts } = fakeGmail({ sentTo: ["a@b.example"] });
    let loaded = false;
    const loadRateCard = async () => {
      loaded = true;
      return card;
    };
    const result = await createDraft({ gmail, loadRateCard, rules: async () => rules, internalIds: [] }, { to: ["a@b.example"], subject: "Café ☕", body: "See you Tuesday.", prices: [], discounts: [] });
    expect(result.created).toBe(true);
    expect(loaded).toBe(false);
    expect(decodeRaw(drafts[0]?.message?.raw ?? "").headers).toContain("Subject: =?UTF-8?B?");
  });

  it("refuses a reply to someone not on the thread, and to a planted Reply-To", async () => {
    const { gmail, drafts } = fakeGmail();
    const deps = { gmail, loadRateCard: async () => card, rules: async () => rules, internalIds: [] };
    const r = await createDraft(deps, { thread_id: "t-123", to: ["eve@evil.example"], body: "Hi", prices: [], discounts: [] });
    expect(r.created).toBe(false);
    if (!r.created) expect(r.reasons[0]).toMatch(/\[recipient\] eve@evil.example isn't on this thread/);
    // Someone else at the buyer's company is fine.
    const ok = await createDraft(deps, { thread_id: "t-123", to: ["cfo@acme.example"], body: "Hi", prices: [], discounts: [] });
    expect(ok.created).toBe(true);
    expect(drafts).toHaveLength(1);
  });

  it("refuses a new email to someone never emailed before", async () => {
    const { gmail, drafts } = fakeGmail({ sentTo: ["acme.example"] });
    const deps = { gmail, loadRateCard: async () => card, rules: async () => rules, internalIds: [] };
    const r = await createDraft(deps, { to: ["new@stranger.example"], subject: "Hello", body: "Hi", prices: [], discounts: [] });
    expect(r.created).toBe(false);
    const ok = await createDraft(deps, { to: ["anyone@acme.example"], subject: "Hello", body: "Hi", prices: [], discounts: [] });
    expect(ok.created).toBe(true);
    expect(drafts).toHaveLength(1);
  });

  it("reports every failing check at once", async () => {
    const { gmail, drafts } = fakeGmail();
    const deps = { gmail, loadRateCard: async () => card, rules: async () => rules, internalIds: ["RATECARD-SHEET-ID-123"] };
    const r = await createDraft(deps, {
      thread_id: "t-123",
      body: "Hi [First Name], Pro is $40, 30% off, guaranteed. Our floor price is low. docs.google.com/spreadsheets/d/RATECARD-SHEET-ID-123",
      prices: [{ item: "Pro", unit_price: 40 }],
      discounts: [],
    });
    expect(r.created).toBe(false);
    if (!r.created) {
      const checks = new Set(r.reasons.map((x) => x.match(/^\[(\w+)\]/)?.[1]));
      expect([...checks].sort()).toEqual(["discount", "leak", "pricing", "words"]);
    }
    expect(drafts).toHaveLength(0);
  });
});
