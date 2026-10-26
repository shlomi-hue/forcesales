import { describe, expect, it } from "vitest";
import type { gmail_v1 } from "@googleapis/gmail";
import type { Gmail } from "../../src/tools/gmail.js";
import { ownWords, scanMail, scanTable } from "../../src/tools/scan.js";
import { tempDataDir } from "./fake-google.js";

const ME = "me@seller.example";
const msg = (from: string, to: string, extra: Record<string, string> = {}, date = "1740000000000"): gmail_v1.Schema$Message => ({
  internalDate: date,
  payload: { headers: [{ name: "From", value: from }, { name: "To", value: to }, { name: "Subject", value: `Re: with ${to}` }, ...Object.entries(extra).map(([name, value]) => ({ name, value }))] },
});

const THREADS: Record<string, gmail_v1.Schema$Message[]> = {
  t1: [msg("Dana <dana@acme.example>", ME), msg(ME, "dana@acme.example, raj@acme.example")],
  t2: [msg(ME, "dana@acme.example", {}, "1750000000000")],
  t3: [msg(ME, "friend@gmail.com")], // personal
  t4: [msg(ME, "news@vendor.example", { "List-Unsubscribe": "<mailto:x>" })], // newsletter
  t5: [msg("pat@globex.example", ME)], // the user never wrote: not a deal thread
  t6: [msg(ME, "boss@seller.example")], // own company
  t7: [msg(ME, "noreply@tool.example")], // automated
  t8: [msg(ME, "lee@investor.example")], // excluded by the user
};

function fake() {
  let gets = 0;
  const gmail = {
    users: {
      getProfile: async () => ({ data: { emailAddress: ME } }),
      threads: {
        list: async () => ({ data: { threads: Object.keys(THREADS).map((id) => ({ id, historyId: `h-${id}` })) } }),
        get: async ({ id }: { id: string }) => {
          gets++;
          return { data: { id, messages: THREADS[id] } };
        },
      },
    },
  } as unknown as Gmail;
  return { gmail, gets: () => gets };
}

const opts = { months: 12, excludeDomains: ["investor.example"], excludeLabels: [], maxThreads: 100, top: 10 };

describe("mail scan", () => {
  it("groups threads the user wrote in by outside company, skipping personal, bulk, automated and excluded mail", async () => {
    const dir = tempDataDir();
    const { gmail } = fake();
    const r = await scanMail(gmail, dir, opts);
    expect(r.domains.map((d) => d.domain)).toEqual(["acme.example"]);
    expect(r.domains[0]).toMatchObject({ threads: 2, myMessages: 2, first: "2025-02-19", last: "2025-06-15", threadIds: ["t1", "t2"] });
    expect(r.domains[0]?.contacts).toEqual([["dana@acme.example", 2], ["raj@acme.example", 1]]);
    expect(scanTable(r.domains, opts, "2026-10-26")).toContain("| acme.example | 2 | 2 | 2025-02-19 | 2025-06-15 |");
  });

  it("uses the cache on a re-run", async () => {
    const dir = tempDataDir();
    const first = fake();
    await scanMail(first.gmail, dir, opts);
    expect(first.gets()).toBe(8);
    const second = fake();
    const r = await scanMail(second.gmail, dir, opts);
    expect(second.gets()).toBe(0);
    expect(r.fetched).toBe(0);
  });

  it("keeps only the user's own words from a sent email", () => {
    expect(ownWords("Hi Dana,\nSounds good.\n\nOn Tue, Dana wrote:\n> old text")).toBe("Hi Dana,\nSounds good.");
    expect(ownWords("Thanks\n---------- Forwarded message ---------\nstuff")).toBe("Thanks");
  });
});
