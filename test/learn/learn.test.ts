import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { gmail_v1 } from "@googleapis/gmail";
import { describe, expect, it } from "vitest";
import { applyLessonAnswer } from "../../src/cli/lessons.js";
import { loadRules } from "../../src/data/settings.js";
import { readConfig } from "../../src/config.js";
import { normPhrase, wordDiff } from "../../src/learn/diff.js";
import { playLessons, voiceLessons } from "../../src/learn/learn.js";
import { compareDraft, formatEdit, parseEdits, readPending, type EditRecord } from "../../src/memory/edits.js";
import { bannedFromLessons, formatLesson, parseLessons, type Lesson } from "../../src/memory/lessons.js";
import { formatOutcome } from "../../src/memory/outcomes.js";
import { wordsCheck } from "../../src/checks/words.js";
import { captureSent, learnLessons, proposeLesson, recordDraft } from "../../src/tools/learn.js";
import { memoryWrite, type MemoryDeps } from "../../src/tools/memory.js";
import type { Gmail } from "../../src/tools/gmail.js";
import { tempDataDir } from "../tools/fake-google.js";

const TODAY = "2026-10-26";
const deps = (): MemoryDeps => ({ dir: tempDataDir(), sourceText: async () => null });
const read = (d: MemoryDeps, rel: string) => readFileSync(join(d.dir, rel), "utf8");

const draft = (name: string) => `Hi ${name},\n\nI hope this finds you well. Here is the pricing for 40 seats.\n\nLet me know if you have any questions.\n\nShlomi`;
const sent = (name: string) => `Hi ${name},\n\nHere is the pricing for 40 seats.\n\nCan you confirm by Friday?\n\nShlomi`;

// Three drafts the user edited the same way before sending.
function threeEdits(): EditRecord[] {
  return ["Dana", "Bob", "Mei"].map((n, i) => {
    const c = compareDraft(draft(n), sent(n));
    return parseEdits(formatEdit({ date: `2026-10-0${i + 1}`, draftId: `d-${i}`, account: `c${i}.example`, subject: "Pricing", sent: `2026-10-0${i + 2}`, ...c }))[0] as EditRecord;
  });
}

describe("word diff", () => {
  it("finds cuts, changes and additions, ignoring case and punctuation", () => {
    expect(wordDiff("a b c d", "a b c d")).toEqual([]);
    expect(wordDiff("Thanks. We can start", "thanks We can start")).toEqual([]);
    expect(wordDiff("Hi Dana. I hope you are well. Pricing below.", "Hi Dana. Pricing below.")).toEqual([{ removed: "I hope you are well.", added: "" }]);
    expect(wordDiff("Pricing below. Thanks!", "Pricing below. Best, Shlomi")).toEqual([{ removed: "Thanks!", added: "Best, Shlomi" }]);
    expect(wordDiff("one two", "one two three")).toEqual([{ removed: "", added: "three" }]);
  });

  it("normalizes phrases for comparing", () => {
    expect(normPhrase("  “I hope this finds you WELL.” ")).toBe("i hope this finds you well");
  });
});

describe("edit records", () => {
  it("round-trip through markdown with only the changed words", () => {
    const c = compareDraft(draft("Dana"), sent("Dana"));
    const md = formatEdit({ date: "2026-10-01", draftId: "d-1", account: "acme.example", subject: "Re: Pricing", sent: "2026-10-02", ...c });
    expect(md).toContain('- cut: "I hope this finds you well."');
    expect(md).toContain('- changed: "Let me know if you have any questions." → "Can you confirm by Friday?"');
    expect(md).not.toContain("40 seats");
    expect(parseEdits(md)).toEqual([
      { date: "2026-10-01", draftId: "d-1", account: "acme.example", subject: "Re: Pricing", sent: "2026-10-02", cuts: ["I hope this finds you well."], changes: [["Let me know if you have any questions.", "Can you confirm by Friday?"]], adds: [], rewrites: 0, unchanged: false },
    ]);
  });

  it("records long rewrites as a count, not text", () => {
    const long = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    const c = compareDraft(`Start. ${long} End.`, "Start. Something else entirely now. End.");
    expect(c.rewrites).toBe(1);
    expect(formatEdit({ date: TODAY, draftId: "d", account: "a", subject: "s", sent: TODAY, ...c })).not.toContain("w12");
  });
});

describe("voice lessons from edits", () => {
  it("three drafts edited the same way make one proposed rule per phrase", () => {
    const lessons = voiceLessons(threeEdits(), TODAY);
    expect(lessons.map((l) => l.rule).sort()).toEqual([
      'Never write "I hope this finds you well"',
      'Write "Can you confirm by Friday" instead of "Let me know if you have any questions"',
    ]);
    expect(lessons[0]?.why).toMatch(/in 3 drafts before sending \(c0\.example 2026-10-01/);
  });

  it("two drafts aren't enough, and the same draft twice counts once", () => {
    const e = threeEdits();
    expect(voiceLessons(e.slice(0, 2), TODAY)).toEqual([]);
    expect(voiceLessons([e[0], e[0], e[0]] as EditRecord[], TODAY)).toEqual([]);
  });

  it("never learns from numbers or lone short words", () => {
    const e = (id: string): EditRecord => ({ date: TODAY, draftId: id, account: "a", subject: "", sent: TODAY, cuts: ["$40 per seat", "Hi", "by 2026-11-01"], changes: [], adds: [], rewrites: 0, unchanged: false });
    expect(voiceLessons([e("1"), e("2"), e("3")], TODAY)).toEqual([]);
  });
});

describe("play lessons from confirmed outcomes", () => {
  const deal = (account: string, outcome: "won" | "lost", confirmed: boolean, reason?: string) => ({
    account, name: account, competitor: "Globex", worked: [], wentWrong: [],
    outcome: { confirmed, account, outcome, closed: "2025-09-10", evidence: "x", source: "gmail/thread/t", ...(reason ? { reason } : {}) },
  });

  it("proposes a repeated loss reason and a competitor you keep losing to, from confirmed deals only", () => {
    const deals = [deal("a", "lost", true, "No budget"), deal("b", "lost", true, "no budget."), deal("c", "lost", true, "No budget"), deal("d", "won", true), deal("e", "lost", false, "No budget")];
    const rules = playLessons(deals, TODAY).map((l) => l.rule);
    expect(rules).toEqual([
      'Plan early for "No budget": it\'s why 3 confirmed deals were lost or stalled',
      "Against Globex, you lost 3 of 4 confirmed deals: build the battle card before the first proposal",
    ]);
    expect(playLessons(deals.slice(0, 2), TODAY)).toEqual([]);
  });
});

describe("lessons files", () => {
  const lesson: Lesson = { kind: "voice", rule: 'Never write "I hope this finds you well"', id: "L-abc123", status: "proposed", why: "you cut it from 3 drafts", since: TODAY };

  it("format and parse", () => {
    expect(parseLessons(formatLesson(lesson))).toEqual([lesson]);
  });

  it("only accepted lessons ban words; hand-written lines in the same form count", () => {
    expect(bannedFromLessons(formatLesson(lesson))).toEqual(["I hope this finds you well"]);
    expect(bannedFromLessons('- Never write "circling back"\n- Write "Hi Dana" instead of "Dear Dana"\n- Be brief')).toEqual(["circling back", "Dear Dana"]);
  });

  it("accept moves voice to accepted.md and plays to the playbook; reject marks it and changes nothing else", () => {
    const files = { proposed: `# Proposed\n\n${formatLesson(lesson)}\n`, accepted: "# Accepted\n", playbook: "# Playbook\n" };
    const a = applyLessonAnswer(files, lesson, "a", TODAY);
    expect(parseLessons(a.proposed)).toEqual([]);
    expect(a.accepted).toContain('- [voice] Never write "I hope this finds you well" · id: L-abc123');
    expect(a.playbook).toBe(files.playbook);
    const play = { ...lesson, kind: "play" as const, rule: "Plan early for budget" };
    const p = applyLessonAnswer({ ...files, proposed: formatLesson(play) }, play, "a", TODAY);
    expect(p.playbook).toContain("Plan early for budget");
    const r = applyLessonAnswer(files, lesson, "r", TODAY);
    expect(parseLessons(r.proposed)[0]?.status).toBe("rejected");
    expect(r.accepted).toBe(files.accepted);
    expect(applyLessonAnswer(files, lesson, "s", TODAY)).toEqual(files);
  });
});

describe("the learning loop (Phase 7 check)", () => {
  async function withEdits(): Promise<MemoryDeps> {
    const d = deps();
    const md = threeEdits().map((e, i) => formatEdit({ ...e, ...compareDraft(draft(["Dana", "Bob", "Mei"][i] ?? ""), sent(["Dana", "Bob", "Mei"][i] ?? "")) })).join("\n");
    await memoryWrite(d, { path: "memory/edits/2026-10.md", content: md, mode: "replace" }, "edits", true);
    return d;
  }
  const banned = (d: MemoryDeps) => loadRules(d.dir, readConfig({})).banned;
  const body = "Hi Dana,\n\nI hope this finds you well. Pricing attached.";

  it("edit three drafts the same way → one proposed rule, not applied until accepted", async () => {
    const d = await withEdits();
    const out = await learnLessons(d, TODAY);
    expect(out).toContain("Proposed 2 new lesson(s)");
    const proposed = parseLessons(read(d, "memory/lessons/proposed.md"));
    expect(proposed.filter((l) => l.rule === 'Never write "I hope this finds you well"')).toHaveLength(1);
    // Proposed isn't applied.
    expect(wordsCheck({ body, banned: banned(d) }).ok).toBe(true);
    // Running again proposes nothing new.
    expect(await learnLessons(d, TODAY)).toContain("Nothing new to propose");
  });

  it("reject it → not applied and never proposed again; accept it → drafts using it are refused", async () => {
    const d = await withEdits();
    await learnLessons(d, TODAY);
    const file = join(d.dir, "memory/lessons/proposed.md");
    const l = parseLessons(readFileSync(file, "utf8")).find((x) => x.rule.startsWith("Never write")) as Lesson;
    const files = { proposed: readFileSync(file, "utf8"), accepted: read(d, "memory/lessons/accepted.md"), playbook: read(d, "company/playbook.md") };

    const rejected = applyLessonAnswer(files, l, "r", TODAY);
    writeFileSync(file, rejected.proposed);
    expect(wordsCheck({ body, banned: banned(d) }).ok).toBe(true);
    await learnLessons(d, TODAY);
    expect(parseLessons(readFileSync(file, "utf8")).filter((x) => x.id === l.id).map((x) => x.status)).toEqual(["rejected"]);

    const accepted = applyLessonAnswer(files, l, "a", TODAY);
    writeFileSync(join(d.dir, "memory/lessons/accepted.md"), accepted.accepted);
    expect(wordsCheck({ body, banned: banned(d) }).reasons).toEqual(['Uses "I hope this finds you well", which is on the banned list.']);
  });

  it("the agent can't write lessons or edits directly, or accept anything", async () => {
    const d = deps();
    await expect(memoryWrite(d, { path: "memory/lessons/proposed.md", content: "x", mode: "replace" })).rejects.toThrow(/written only by lessons_learn/);
    await expect(memoryWrite(d, { path: "memory/edits/2026-10.md", content: "x", mode: "replace" })).rejects.toThrow(/written only by edits_capture/);
    await expect(memoryWrite(d, { path: "memory/lessons/accepted.md", content: "x", mode: "replace" })).rejects.toThrow(/belongs to you/);
    expect(await proposeLesson(d, { kind: "play", rule: "Bring the CFO in before pricing", why: "acme, beta and gamma stalled at the CFO" }, TODAY)).toMatch(/^Proposed L-/);
    expect(await proposeLesson(d, { kind: "play", rule: "bring the CFO in before pricing.", why: "again" }, TODAY)).toMatch(/^Not added/);
  });

  it("ignores unconfirmed outcomes", async () => {
    const d = deps();
    const lines = ["a", "b", "c"].map((a) => formatOutcome({ confirmed: false, account: a, outcome: "lost", reason: "no budget", evidence: "x", source: "gmail/thread/t" })).join("\n");
    await memoryWrite(d, { path: "memory/history/outcomes.md", content: lines, mode: "replace" }, "o", true);
    for (const a of ["a", "b", "c"]) await memoryWrite(d, { path: `memory/history/${a}.md`, content: `# ${a}\n`, mode: "replace" });
    expect(await learnLessons(d, TODAY)).toContain("Nothing new to propose");
  });
});

describe("edits_capture", () => {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
  const created = "2026-10-20T01:00:00.000Z";
  const msg = (id: string, labels: string[], at: string, text: string): gmail_v1.Schema$Message => ({
    id, labelIds: labels, internalDate: String(Date.parse(at)), payload: { mimeType: "text/plain", body: { data: b64(text) } },
  });

  function fake(threads: Record<string, gmail_v1.Schema$Message[]>, liveDrafts: string[]): Gmail {
    const notFound = () => Object.assign(new Error("Requested entity was not found."), { code: 404 });
    return {
      users: {
        drafts: { get: async ({ id }: { id: string }) => (liveDrafts.includes(id) ? { data: { id } } : Promise.reject(notFound())) },
        threads: { get: async ({ id }: { id: string }) => (threads[id] ? { data: { id, messages: threads[id] } } : Promise.reject(notFound())) },
      },
    } as unknown as Gmail;
  }

  it("pairs sent drafts, keeps unsent ones, drops deleted ones, and stores only the changed words", async () => {
    const d = deps();
    const base = { to: ["Dana Lee <dana@acme.example>"], subject: "Re: Pricing", body: draft("Dana"), created };
    await recordDraft(d.dir, { ...base, draftId: "r-sent", threadId: "t-1" });
    await recordDraft(d.dir, { ...base, draftId: "r-waiting", threadId: "t-2" });
    await recordDraft(d.dir, { ...base, draftId: "r-deleted", threadId: "t-3" });
    const gmail = fake(
      {
        "t-1": [
          msg("m0", ["INBOX"], "2026-10-19T00:00:00Z", "Can you send pricing?"),
          msg("m1", ["SENT"], "2026-10-21T03:00:00Z", `${sent("Dana")}\n\nOn Mon, Dana Lee wrote:\n> Can you send pricing?`),
        ],
        "t-3": [msg("m2", ["INBOX"], "2026-10-19T00:00:00Z", "hello")],
      },
      ["r-waiting"],
    );
    const r = await captureSent(gmail, d, new Date("2026-10-26T00:00:00Z"));
    expect(r).toMatchObject({ paired: 1, unchanged: 0, waiting: 1, discarded: 1, expired: 0, files: ["memory/edits/2026-10.md"] });
    expect(readPending(d.dir).map((p) => p.draftId)).toEqual(["r-waiting"]);
    const md = read(d, "memory/edits/2026-10.md");
    const [e] = parseEdits(md);
    expect(e).toMatchObject({ draftId: "r-sent", account: "acme.example", cuts: ["I hope this finds you well."], changes: [["Let me know if you have any questions.", "Can you confirm by Friday?"]], adds: [] });
    expect(md).not.toContain("Dana Lee wrote");
    expect(existsSync(join(d.dir, ".gitignore")) && readFileSync(join(d.dir, ".gitignore"), "utf8")).toContain("memory/edits/pending.json");
  });

  it("drops drafts unsent for over 30 days", async () => {
    const d = deps();
    await recordDraft(d.dir, { draftId: "old", threadId: "t", to: ["a@b.example"], subject: "s", body: "b", created: "2026-08-01T00:00:00Z" });
    const r = await captureSent(fake({}, ["old"]), d, new Date("2026-10-26T00:00:00Z"));
    expect(r).toMatchObject({ waiting: 0, expired: 1 });
    expect(readPending(d.dir)).toEqual([]);
  });
});

describe("word diff merging", () => {
  it("doesn't merge edits across a sentence end", () => {
    expect(wordDiff("Hi. I hope you are well. Here is pricing.", "Hi. Here is the pricing.")).toEqual([
      { removed: "I hope you are well.", added: "" },
      { removed: "", added: "the" },
    ]);
  });
});
