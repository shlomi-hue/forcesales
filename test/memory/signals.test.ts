import { describe, expect, it } from "vitest";
import { formatSignal, newSignals, parseSignals } from "../../src/memory/signals.js";

const line = `- [budget] "we have Q1 money set aside" — Dana Lee, 2026-10-02\n  source: gmail/thread/abc · expires: 2027-01-02 · status: live`;

describe("signals", () => {
  it("formats and parses the standard line", () => {
    const s = { type: "budget", quote: "we have Q1 money set aside", who: "Dana Lee", date: "2026-10-02", source: "gmail/thread/abc", expires: "2027-01-02", status: "live" };
    expect(formatSignal(s)).toBe(line);
    expect(parseSignals(`# Acme\n\n${line}\n`).signals[0]).toMatchObject(s);
  });

  it("finds signals added since the last version, and malformed ones", () => {
    const next = `${line}\n- [timeline] "by March" — Dana Lee, 2026-10-03\n  source: gmail/thread/abc · status: live\n- [risk] "no source line" — Bob, 2026-10-01\n`;
    const { added, malformed } = newSignals(line, next);
    expect(added.map((s) => s.type)).toEqual(["timeline"]);
    expect(malformed).toEqual(['- [risk] "no source line" — Bob, 2026-10-01']);
  });
});
