// Threads eval: recorded buyer threads with gold answers.
//
// In code, every run: each draft attempt gets the verdict the gold expects (pricing, discount,
// words, leak), every gold quote is kept by memory_add_signal, and every paraphrased decoy is dropped.
// With EVAL_AGENT=1: Claude Code runs /account on each thread, and we score the account file it
// writes: signals (recall and precision against gold), people and roles, who signs (decision map),
// and promises logged.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parsePromises } from "../../src/memory/promises.js";
import { parseSignals } from "../../src/memory/signals.js";
import { accountSlug } from "../../src/tools/memory.js";
import { agentSkip, runAgent } from "../lib/agent.js";
import { fixtureDeps, inMemoryClient, textOf, toThread, type FixtureMessage } from "../lib/fixtures.js";
import { mentions, sameQuote } from "../lib/match.js";
import { ratio, record } from "../lib/score.js";

interface Case {
  name: string;
  company: string;
  domain: string;
  messages: FixtureMessage[];
  signals: { type: string; quote: string }[];
  decoys: { type: string; quote: string }[];
  people: { name: string; role: string }[];
  signer: string;
  promises: { owner: "us" | "them"; who: string; quote: string }[];
  drafts: { about: string; args: Record<string, unknown>; expect: string }[];
}

const DIR = join("evals", "threads", "cases");
const cases: Case[] = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as Case);
const accounts = cases.map((c) => ({ name: c.company, domains: [c.domain] }));
const threadId = (c: Case) => `t-${c.name}`;
const setup = (c: Case) => fixtureDeps(toThread(threadId(c), c.messages), { accounts, sentTo: [c.domain] });
const firstMessageDate = (c: Case) => new Date(c.messages[0]?.date ?? "2026-10-01").toISOString().slice(0, 10);

const tally = { drafts: 0, draftsRight: 0, gold: 0, goldKept: 0, decoys: 0, decoysDropped: 0, quoteCases: 0, quoteCasesRight: 0 };
const agent = { runs: 0, ran: 0, goldSignals: 0, found: 0, typeRight: 0, kept: 0, keptMatching: 0, people: 0, peopleFound: 0, rolesFound: 0, signers: 0, signersFound: 0, promises: 0, promisesFound: 0 };
const failures: string[] = [];
const skip = agentSkip();

describe("threads", () => {
  for (const c of cases) {
    describe(c.name, () => {
      for (const d of c.drafts) {
        it(`draft: ${d.about} → ${d.expect}`, async () => {
          const { deps, drafts } = setup(c);
          const client = await inMemoryClient(deps);
          const r = await client.callTool({ name: "gmail_draft", arguments: { thread_id: threadId(c), ...d.args } });
          const t = textOf(r);
          const right = d.expect === "ok" ? !r.isError && drafts.length === 1 : r.isError === true && t.includes(`[${d.expect}]`) && drafts.length === 0;
          tally.drafts++;
          if (right) tally.draftsRight++;
          else failures.push(`${c.name}: draft "${d.about}" expected ${d.expect}, got: ${t.slice(0, 160)}`);
          expect(right).toBe(true);
        });
      }

      it("keeps every gold quote and drops every paraphrase", async () => {
        const { deps } = setup(c);
        const client = await inMemoryClient(deps);
        const add = async (s: { type: string; quote: string }) =>
          textOf(await client.callTool({ name: "memory_add_signal", arguments: { account: c.company, type: s.type, quote: s.quote, who: "Buyer", date: firstMessageDate(c), source: `gmail/thread/${threadId(c)}` } }));
        const before = failures.length;
        for (const s of c.signals) {
          tally.gold++;
          const out = await add(s);
          if (/1 new signal\(s\) kept/.test(out)) tally.goldKept++;
          else failures.push(`${c.name}: gold quote dropped: "${s.quote}" (${out.split("\n").slice(-1)[0]})`);
        }
        for (const s of c.decoys) {
          tally.decoys++;
          const out = await add(s);
          if (/Dropped 1/.test(out)) tally.decoysDropped++;
          else failures.push(`${c.name}: paraphrase kept: "${s.quote}"`);
        }
        tally.quoteCases++;
        if (failures.length === before) tally.quoteCasesRight++;
        expect(failures.slice(before)).toEqual([]);
      });

      it.skipIf(skip !== null)("agent: /account builds the file from the thread", async () => {
        const { deps } = setup(c);
        agent.runs++;
        const prompt = `Use the account skill for ${c.company} (email domain ${c.domain}). This is an unattended run: don't ask questions, use only what the tools return, and don't create drafts. Log any promises you find with promise_log, using a due date a week after the message when none is given.`;
        const run = await runAgent(deps, prompt);
        const rel = `memory/accounts/${accountSlug(c.company)}.md`;
        const file = join(deps.memory.dir, rel);
        if (!run.ok || !existsSync(file)) {
          failures.push(`${c.name}: agent run failed or wrote no account file: ${run.out.slice(-300)}`);
          expect.fail("no account file");
        }
        agent.ran++;
        const md = readFileSync(file, "utf8");
        const kept = parseSignals(md).signals;
        for (const g of c.signals) {
          agent.goldSignals++;
          const hit = kept.find((k) => sameQuote(g.quote, k.quote));
          if (hit) {
            agent.found++;
            if (hit.type === g.type) agent.typeRight++;
            else failures.push(`${c.name}: note: agent typed "${g.quote}" as [${hit.type}], gold says [${g.type}]`);
          } else failures.push(`${c.name}: agent missed signal [${g.type}] "${g.quote}"`);
        }
        agent.kept += kept.length;
        for (const k of kept.filter((k) => !c.signals.some((g) => sameQuote(g.quote, k.quote)))) failures.push(`${c.name}: note: agent kept a signal not in gold: [${k.type}] "${k.quote}"`);
        agent.keptMatching += kept.filter((k) => c.signals.some((g) => sameQuote(g.quote, k.quote))).length;
        const section = (name: string) => md.split(/^## /m).find((s) => s.toLowerCase().startsWith(name)) ?? "";
        const people = section("people").split("\n");
        for (const p of c.people) {
          agent.people++;
          const line = people.find((l) => mentions(l, p.name));
          if (line) agent.peopleFound++;
          else failures.push(`${c.name}: agent left out ${p.name}`);
          if (line && mentions(line, p.role)) agent.rolesFound++;
          else if (line) failures.push(`${c.name}: agent's role for ${p.name} doesn't say "${p.role}"`);
        }
        agent.signers++;
        const signs = section("decision map").split("\n").find((l) => /\bsigns?\b|final call|approv/i.test(l)) ?? "";
        if (mentions(signs, c.signer)) agent.signersFound++;
        else failures.push(`${c.name}: decision map doesn't say ${c.signer} signs (got: ${signs.slice(0, 120) || "nothing"})`);
        const pfile = join(deps.memory.dir, `memory/deals/${accountSlug(c.company)}/promises.md`);
        const logged = existsSync(pfile) ? parsePromises(readFileSync(pfile, "utf8")).promises : [];
        for (const g of c.promises) {
          agent.promises++;
          if (logged.some((p) => p.owner === g.owner && sameQuote(g.quote, p.quote))) agent.promisesFound++;
          else failures.push(`${c.name}: agent didn't log ${g.owner} promise "${g.quote}"`);
        }
      });
    });
  }

  afterAll(() => {
    const ranAgent = agent.ran > 0;
    const passed = tally.draftsRight + tally.quoteCasesRight;
    record({
      set: "threads",
      about: `${cases.length} recorded threads. In code: draft verdicts (pricing, discount, words, leak) and quote checks on gold quotes and paraphrased decoys. ${ranAgent ? `Agent: Claude Code ran /account on ${agent.ran} of ${agent.runs} threads; signals, people, roles, who signs and promises scored against gold.` : "The agent part didn't run."}`,
      cases: tally.drafts + tally.quoteCases + (ranAgent ? agent.runs : 0),
      passed: passed + (ranAgent ? agent.ran : 0),
      metrics: {
        "draft verdicts right": ratio(tally.draftsRight, tally.drafts),
        "gold quotes kept": ratio(tally.goldKept, tally.gold),
        "paraphrases dropped": ratio(tally.decoysDropped, tally.decoys),
        ...(ranAgent
          ? {
              "signal recall": ratio(agent.found, agent.goldSignals),
              "signal precision (vs gold)": ratio(agent.keptMatching, agent.kept),
              "signal type right": ratio(agent.typeRight, agent.found),
              "people found": ratio(agent.peopleFound, agent.people),
              "roles right": ratio(agent.rolesFound, agent.people),
              "signer in decision map": ratio(agent.signersFound, agent.signers),
              "promises logged": ratio(agent.promisesFound, agent.promises),
            }
          : {}),
      },
      failures,
      ...(skip ? { skipped: skip } : {}),
    });
  });
});
