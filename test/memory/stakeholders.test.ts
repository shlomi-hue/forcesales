import { describe, expect, it } from "vitest";
import { addSignal, memoryWrite, type MemoryDeps } from "../../src/tools/memory.js";
import { logPromise } from "../../src/tools/promises.js";
import { stakeholderView } from "../../src/tools/stakeholders.js";
import { tempDataDir } from "../tools/fake-google.js";

const SRC = "Dana: we need SSO before March. Raj: the budget is capped at 40k. Dana will send the questionnaire.";

describe("stakeholderView", () => {
  it("shows one person's role, words and promises, and nobody else's", async () => {
    const d: MemoryDeps = { dir: tempDataDir(), sourceText: async () => SRC };
    await memoryWrite(d, {
      path: "memory/accounts/acme.md",
      content: "# Acme\ndomains: acme.example\n\n## People\n- Dana Lee · VP Ops · dana@acme.example · champion\n- Raj Patel · CFO · raj@acme.example · signs\n\n## Signals\n",
      mode: "replace",
    });
    const sig = { account: "Acme", date: "2026-10-20", source: "gmail/thread/t1" };
    await addSignal(d, { ...sig, type: "need", quote: "we need SSO before March", who: "Dana Lee" });
    await addSignal(d, { ...sig, type: "budget", quote: "the budget is capped at 40k", who: "Raj Patel" });
    await logPromise(d, { account: "Acme", owner: "them", who: "Dana Lee", what: "send the questionnaire", due: "2026-10-30", quote: "Dana will send the questionnaire", source: "gmail/thread/t1" });

    const dana = stakeholderView(d, "Acme", "Dana Lee");
    expect(dana).toContain("role: Dana Lee · VP Ops · champion");
    expect(dana).toContain('[need] "we need SSO before March"');
    expect(dana).toContain("open: send the questionnaire, due 2026-10-30");
    expect(dana).not.toContain("budget");
    expect(dana).not.toContain("Raj");
    expect(dana).not.toContain("dana@acme.example");

    const raj = stakeholderView(d, "Acme", "raj patel");
    expect(raj).toContain("capped at 40k");
    expect(raj).not.toContain("SSO");
    expect(stakeholderView(d, "Acme", "Nobody")).toContain("Nothing on file for Nobody");
  });
});
