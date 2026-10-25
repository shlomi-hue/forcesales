import { describe, expect, it } from "vitest";
import { parseRateCard } from "../../src/checks/rate-card.js";
import { createDraft, readThread, searchThreads } from "../../src/tools/gmail.js";
import { simple } from "../checks/fixtures.js";
import { decodeRaw, fakeGmail } from "./fake-google.js";

const card = parseRateCard(simple);

describe("gmail read", () => {
  it("returns a thread's text inside one data block, attachments and HTML stripped", async () => {
    const { gmail } = fakeGmail();
    const out = await readThread(gmail, "t-123");
    expect(out.startsWith('<<<OUTSIDE_DATA source="gmail/thread/t-123">>>')).toBe(true);
    expect(out).toContain("What would Pro cost us for 10 seats?");
    expect(out).toContain("Also & one more thing:\nbudget is tight.");
    expect(out).not.toContain("<div>");
    expect(out).not.toContain("quote.pdf");
    // A fake end marker inside the email can't close the block early.
    expect(out.match(/<<<END_OUTSIDE_DATA>>>/g)).toHaveLength(1);
    expect(out.trimEnd().endsWith("<<<END_OUTSIDE_DATA>>>")).toBe(true);
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
      { gmail, loadRateCard: async () => card },
      { thread_id: "t-123", body: "Hi Dana,\nPro is $55 per seat, so $550 for 10.\nShlomi", prices: [{ item: "Pro", unit_price: 55, quantity: 10 }] },
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
      { gmail, loadRateCard: async () => card },
      { thread_id: "t-123", body: "Pro is $40 per seat.", prices: [{ item: "Pro", unit_price: 40 }] },
    );
    expect(result.created).toBe(false);
    if (!result.created) expect(result.reasons[0]).toContain("below the rate card floor of 50 USD");
    expect(drafts).toHaveLength(0);
  });

  it("refuses an undeclared price, and a price when no rate card is set up", async () => {
    const { gmail, drafts } = fakeGmail();
    const undeclared = await createDraft({ gmail, loadRateCard: async () => card }, { to: ["a@b.example"], subject: "Hi", body: "Only $30!", prices: [] });
    const noCard = await createDraft({ gmail, loadRateCard: async () => null }, { to: ["a@b.example"], subject: "Hi", body: "Pro is $55", prices: [{ item: "Pro", unit_price: 55 }] });
    expect(undeclared.created).toBe(false);
    expect(noCard.created).toBe(false);
    expect(drafts).toHaveLength(0);
  });

  it("doesn't load the rate card for a draft with no prices", async () => {
    const { gmail, drafts } = fakeGmail();
    let loaded = false;
    const loadRateCard = async () => {
      loaded = true;
      return card;
    };
    const result = await createDraft({ gmail, loadRateCard }, { to: ["a@b.example"], subject: "Café ☕", body: "See you Tuesday.", prices: [] });
    expect(result.created).toBe(true);
    expect(loaded).toBe(false);
    expect(decodeRaw(drafts[0]?.message?.raw ?? "").headers).toContain("Subject: =?UTF-8?B?");
  });
});
