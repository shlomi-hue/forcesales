import { describe, expect, it } from "vitest";
import { baseline, icpMap, similarDeals, winRate, type Deal } from "../../src/history/stats.js";
import { parseHistory } from "../../src/memory/history.js";
import type { Outcome } from "../../src/memory/outcomes.js";

function deal(account: string, industry: string, size: string, outcome: Outcome, confirmed = true, extra: Partial<Deal> = {}): Deal {
  return {
    account, name: account, industry, size, worked: [], wentWrong: [],
    outcome: { account, outcome, confirmed, evidence: "x", source: "gmail/thread/x", ...(outcome === "won" ? {} : { reason: "price" }) },
    ...extra,
  };
}

// 6 logistics deals 200-1000 (4 won), 3 retail (1 won), plus unconfirmed and open ones that must not count.
const deals: Deal[] = [
  ...["a", "b", "c", "d"].map((n) => deal(`log-${n}`, "Logistics", "200-1000", "won", true, { value: 40000, currency: "USD", firstContact: "2025-01-01", lastContact: "2025-03-02" })),
  deal("log-e", "logistics", "200-1000", "lost"),
  deal("log-f", "Logistics", "200-1000", "no-decision"),
  deal("ret-a", "Retail", "50-200", "won"),
  deal("ret-b", "Retail", "50-200", "lost"),
  deal("ret-c", "Retail", "50-200", "lost"),
  deal("log-unconfirmed", "Logistics", "200-1000", "lost", false),
  deal("log-open", "Logistics", "200-1000", "open"),
];

describe("history stats", () => {
  it("counts confirmed, closed deals only", () => {
    expect(winRate(deals)).toEqual({ won: 5, total: 9, rate: 5 / 9 });
  });

  it("builds the ICP map with 'too few' under 5 deals, matching a hand count", () => {
    const map = icpMap(deals, "2026-10-26");
    expect(map).toContain("from 9 confirmed, closed past deals (1 more await confirmation");
    expect(map).toContain("| Industry | 200-1000 | 50-200 | All sizes |");
    expect(map).toContain("| Logistics | 4/6 won (67%) | too few (0) | 4/6 won (67%) |");
    expect(map).toContain("| Retail | too few (0) | too few (3) | too few (3) |");
    expect(map).toContain("| All industries | 4/6 won (67%) | too few (3) | 5/9 won (56%) |");
  });

  it("writes base rates, cycle length, deal size and loss reasons", () => {
    const b = baseline(deals, "2026-10-26");
    expect(b).toContain("- confirmed closed deals: 9");
    expect(b).toContain("- win rate: 56%");
    expect(b).toContain("- median days from first contact to close (won deals): 60 (from 4 deals)");
    expect(b).toContain("- median won deal value: 40000 USD (from 4 deals)");
    expect(b).toContain("- price: 4");
  });

  it("finds similar deals, confirmed only unless asked", () => {
    const target = { account: "new", industry: "logistics", size: "200-1000", value: 50000, currency: "USD" };
    const m = similarDeals(target, deals);
    expect(m[0]?.deal.account).toMatch(/^log-[a-d]$/);
    expect(m[0]?.why).toEqual(["same industry", "same size", "similar value"]);
    expect(m.map((x) => x.deal.account)).not.toContain("log-unconfirmed");
    expect(similarDeals(target, deals, { includeUnconfirmed: true, limit: 20 }).map((x) => x.deal.account)).toContain("log-unconfirmed");
  });

  it("reads a history file's features and quotes", () => {
    const d = parseHistory(
      "acme",
      '# Acme\ndomains: acme.com\nindustry: Logistics\nsize: 200-1000\nvalue: 48,000 USD\ncompetitor: none\nfirst contact: 2025-03-02\n\n## What worked\n- [worked] "the rollout plan sold us" — Dana, 2025-08-01\n  source: gmail/thread/x · status: live\n',
    );
    expect(d).toMatchObject({ name: "Acme", industry: "Logistics", value: 48000, currency: "USD", competitor: "none", firstContact: "2025-03-02", worked: ['"the rollout plan sold us" (Dana)'] });
  });
});
