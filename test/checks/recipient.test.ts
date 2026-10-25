import { describe, expect, it } from "vitest";
import { recipientCheck } from "../../src/checks/recipient.js";

const base = { to: [], cc: [], bcc: [], ownEmail: "me@seller.example", threadParticipants: ["dana@acme.example", "me@seller.example"], knownAddresses: [] };

describe("recipientCheck", () => {
  it("passes people on the thread, their colleagues, and my own domain", () => {
    expect(recipientCheck({ ...base, to: ["Dana Lee <dana@acme.example>"], cc: ["cfo@acme.example", "boss@seller.example"] })).toEqual({ ok: true, reasons: [] });
  });

  it("passes a new email to someone emailed before, or their company", () => {
    const r = recipientCheck({ ...base, threadParticipants: null, knownAddresses: ["pat@globex.example"], to: ["pat@globex.example", "lee@globex.example"] });
    expect(r.ok).toBe(true);
  });

  it("refuses an outsider on a reply", () => {
    const r = recipientCheck({ ...base, to: ["dana@acme.example"], cc: ["eve@evil.example"] });
    expect(r.reasons).toEqual(["eve@evil.example isn't on this thread, and nobody from evil.example is either. Add new people yourself in Gmail."]);
  });

  it("doesn't treat free mail as one company", () => {
    const r = recipientCheck({ ...base, threadParticipants: ["dana@gmail.com"], to: ["stranger@gmail.com"] });
    expect(r.ok).toBe(false);
  });

  it("refuses a new email to someone never emailed", () => {
    const r = recipientCheck({ ...base, threadParticipants: null, knownAddresses: [], to: ["new@stranger.example"] });
    expect(r.reasons[0]).toContain("has never been emailed");
  });

  it("refuses bcc outside my domain, even to people on the thread", () => {
    expect(recipientCheck({ ...base, to: ["dana@acme.example"], bcc: ["dana@acme.example"] }).ok).toBe(false);
    expect(recipientCheck({ ...base, to: ["dana@acme.example"], bcc: ["boss@seller.example"] }).ok).toBe(true);
  });

  it("refuses junk and too many recipients", () => {
    expect(recipientCheck({ ...base, to: ["not an address"] }).reasons[0]).toContain("isn't one email address");
    expect(recipientCheck({ ...base, to: ["a@acme.example, b@acme.example"] }).ok).toBe(false);
    const many = Array.from({ length: 21 }, (_, i) => `p${i}@acme.example`);
    expect(recipientCheck({ ...base, to: many }).reasons[0]).toContain("limit is 20");
  });
});
