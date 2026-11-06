// Edits: draft/sent pairs with planted patterns and noise, through the real pipeline
// (diff → edit records → lessons). Scored on precision and recall of the proposed voice rules.
// Then the loop: an accepted rule refuses drafts using the phrase; a rejected one doesn't.

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { applyLessonAnswer } from "../../src/cli/lessons.js";
import { readConfig } from "../../src/config.js";
import { loadRules } from "../../src/data/settings.js";
import { wordsCheck } from "../../src/checks/words.js";
import { voiceLessons } from "../../src/learn/learn.js";
import { compareDraft, formatEdit, parseEdits } from "../../src/memory/edits.js";
import { parseLessons } from "../../src/memory/lessons.js";
import { learnLessons } from "../../src/tools/learn.js";
import { memoryWrite } from "../../src/tools/memory.js";
import { tempDataDir } from "../../test/tools/fake-google.js";
import { ratio, record } from "../lib/score.js";

const fx = JSON.parse(readFileSync(join("evals", "edits", "pairs.json"), "utf8")) as { pairs: { account: string; draft: string; sent: string }[]; expected: string[]; unchanged: number };
const TODAY = "2026-10-26";
const md = fx.pairs
  .map((p, i) => formatEdit({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, draftId: `d-${i + 1}`, account: p.account, subject: "Re: deal", sent: `2026-10-${String(i + 2).padStart(2, "0")}`, ...compareDraft(p.draft, p.sent) }))
  .join("\n");
const edits = parseEdits(md);

const failures: string[] = [];
const checks = { run: 0, passed: 0 };
const metrics: Record<string, string | number> = {};
const check = (ok: boolean, what: string) => {
  checks.run++;
  if (ok) checks.passed++;
  else failures.push(what);
  return ok;
};

describe("edits", () => {
  it("records only changed words, and no prices", () => {
    check(edits.length === fx.pairs.length, `parsed ${edits.length} of ${fx.pairs.length} edit records`);
    check(edits.filter((e) => e.unchanged).length === fx.unchanged, "unchanged drafts miscounted");
    check(!/40 seats|security pack|rollout plan/.test(md), "an edit record kept unchanged text");
    expect(failures).toEqual([]);
  });

  it("proposes the planted rules and nothing from the noise", () => {
    const got = voiceLessons(edits, TODAY).map((l) => l.rule);
    const hits = got.filter((r) => fx.expected.includes(r));
    metrics.precision = ratio(hits.length, got.length);
    metrics.recall = ratio(hits.length, fx.expected.length);
    for (const e of fx.expected) check(got.includes(e), `missed: ${e}`);
    for (const g of got) check(fx.expected.includes(g), `proposed from noise: ${g}`);
    expect(got.sort()).toEqual([...fx.expected].sort());
  });

  it("an accepted rule refuses drafts using it; a rejected one doesn't", async () => {
    const dir = tempDataDir();
    const deps = { dir, sourceText: async () => null };
    await memoryWrite(deps, { path: "memory/edits/2026-10.md", content: md, mode: "replace" }, "edits", true);
    await learnLessons(deps, TODAY);
    const read = (rel: string) => readFileSync(join(dir, rel), "utf8");
    const files = { proposed: read("memory/lessons/proposed.md"), accepted: read("memory/lessons/accepted.md"), playbook: read("company/playbook.md") };
    const lessons = parseLessons(files.proposed);
    const never = lessons.find((l) => l.rule.startsWith("Never write"));
    const instead = lessons.find((l) => l.rule.includes("Best regards"));
    if (!never || !instead) {
      check(false, "learnLessons didn't propose the planted rules");
      return;
    }
    let f = applyLessonAnswer(files, never, "a", TODAY);
    f = applyLessonAnswer(f, instead, "r", TODAY);
    writeFileSync(join(dir, "memory/lessons/accepted.md"), f.accepted);
    writeFileSync(join(dir, "memory/lessons/proposed.md"), f.proposed);
    const banned = loadRules(dir, readConfig({})).banned;
    check(!wordsCheck({ body: "Hi Dana, I hope this finds you well.", banned }).ok, "accepted rule didn't refuse the phrase");
    check(wordsCheck({ body: "Pricing attached.\n\nBest regards,\nShlomi", banned }).ok, "rejected rule still refused the phrase");
    await learnLessons(deps, TODAY);
    check(parseLessons(read("memory/lessons/proposed.md")).filter((l) => l.id === instead.id).every((l) => l.status === "rejected"), "rejected rule came back as proposed");
    expect(failures).toEqual([]);
  });

  afterAll(() => {
    record({ set: "edits", about: `${fx.pairs.length} draft/sent pairs with planted patterns and noise.`, cases: checks.run, passed: checks.passed, metrics, failures });
  });
});
