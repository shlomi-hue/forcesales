import { describe, expect, it } from "vitest";
import { leakCheck } from "../../src/checks/leak.js";

const base = {
  recipients: ["Dana <dana@acme.example>"],
  ownEmail: "me@seller.example",
  internalIds: ["1AbCdEfGhIjKlMnOp"],
  accounts: [
    { name: "Globex", domains: ["globex.example"] },
    { name: "Acme", domains: ["acme.example"] },
  ],
  threadParticipants: ["dana@acme.example", "cfo@acme.example"],
};

describe("leakCheck", () => {
  it("passes a normal reply that names the buyer and their own people", () => {
    const r = leakCheck({ ...base, body: "Hi Dana, looping in cfo@acme.example. Acme's rollout plan attached. Contact me at me@seller.example." });
    expect(r).toEqual({ ok: true, reasons: [] });
  });

  it("refuses internal terms", () => {
    const r = leakCheck({ ...base, body: "Our floor price is 50 and our win probability is high. See the rate card." });
    expect(r.reasons).toEqual([
      'Mentions "floor price", which is internal.',
      'Mentions "win probability", which is internal.',
      'Mentions "rate card", which is internal.',
    ]);
  });

  it("refuses the rate card's id and local paths", () => {
    expect(leakCheck({ ...base, body: "https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOp/edit" }).reasons).toEqual([
      "Links to the rate card or another internal file.",
    ]);
    expect(leakCheck({ ...base, body: "see ~/deal-harness-data/memory/accounts/acme.md" }).ok).toBe(false);
  });

  it("refuses other people's addresses and other customers' names", () => {
    const r = leakCheck({ ...base, body: "Pat at Globex (pat@globex.example) loved it." });
    expect(r.reasons).toEqual(["Contains pat@globex.example, who isn't part of this conversation.", "Names Globex, another customer."]);
  });

  it("refuses a pasted data block", () => {
    expect(leakCheck({ ...base, body: "<<<OUTSIDE_DATA id=1 source=x>>>" }).ok).toBe(false);
  });
});
