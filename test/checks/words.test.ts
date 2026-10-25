import { describe, expect, it } from "vitest";
import { DEFAULT_BANNED, wordsCheck } from "../../src/checks/words.js";

describe("wordsCheck", () => {
  it("passes ordinary text", () => {
    expect(wordsCheck({ body: "Thanks Dana, see attached. Pricing holds through Q1.", banned: DEFAULT_BANNED })).toEqual({ ok: true, reasons: [] });
  });

  it("refuses banned words in body or subject, any case, whole words only", () => {
    const r = wordsCheck({ subject: "Risk-free trial", body: "We GUARANTEE results.", banned: DEFAULT_BANNED });
    expect(r.reasons).toEqual(['Uses "GUARANTEE", which is on the banned list.', 'Uses "Risk-free", which is on the banned list.']);
    expect(wordsCheck({ body: "unguaranteedness", banned: ["guarantee"] }).ok).toBe(true);
  });

  it("refuses unfilled placeholders", () => {
    for (const body of ["Hi [First Name],", "Hi {{name}}", "Price: [TBD]", "TODO add case study", "<insert logo>"]) {
      expect(wordsCheck({ body, banned: [] }).ok, body).toBe(false);
    }
  });
});
