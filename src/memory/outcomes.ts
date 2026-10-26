// memory/history/outcomes.md: one line per past deal. The harness writes outcomes unconfirmed ([ ]);
// only the user ticks them ([x]), by hand or with `deal-harness confirm`. Unticked outcomes never
// feed the ICP map, calibration or lessons.
//
//   - [ ] acme · lost · closed 2025-09-10 · 48000 USD · reason: chose Globex on price
//     evidence: "we've decided to go with Globex" · source: gmail/thread/<id>

export type Outcome = "won" | "lost" | "no-decision" | "open";
export const OUTCOMES: Outcome[] = ["won", "lost", "no-decision", "open"];

export interface OutcomeLine {
  confirmed: boolean;
  account: string;
  outcome: Outcome;
  closed?: string;
  value?: number;
  currency?: string;
  reason?: string;
  evidence: string;
  source: string;
}

export const OUTCOMES_HEADER = `# Outcomes

One line per past deal. The harness fills these in from email and marks each one [ ] (not confirmed).
Tick [x] the ones that are right (or run \`deal-harness confirm\`). Only ticked outcomes feed the ICP map,
calibration and lessons. The harness never ticks them.
`;

const HEAD = /^- \[( |x)\] ([\w.-]+) · (won|lost|no-decision|open)((?: · [^·]+)*)$/;
const TAIL = /^\s+evidence: "(.*)" · source: (\S+)\s*$/;

export function formatOutcome(o: OutcomeLine): string {
  const parts = [o.account, o.outcome];
  if (o.closed) parts.push(`closed ${o.closed}`);
  if (o.value !== undefined) parts.push(`${o.value}${o.currency ? ` ${o.currency}` : ""}`);
  if (o.reason) parts.push(`reason: ${o.reason.replace(/[·\n]/g, " ").trim()}`);
  return `- [${o.confirmed ? "x" : " "}] ${parts.join(" · ")}\n  evidence: "${o.evidence.replace(/\n/g, " ")}" · source: ${o.source}`;
}

export function parseOutcomes(md: string): OutcomeLine[] {
  const lines = md.split("\n");
  const out: OutcomeLine[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = (lines[i] ?? "").match(HEAD);
    const t = (lines[i + 1] ?? "").match(TAIL);
    if (!h || !t) continue;
    const o: OutcomeLine = { confirmed: h[1] === "x", account: h[2] ?? "", outcome: h[3] as Outcome, evidence: t[1] ?? "", source: t[2] ?? "" };
    for (const part of (h[4] ?? "").split(" · ").map((p) => p.trim()).filter(Boolean)) {
      const closed = part.match(/^closed (\d{4}-\d{2}-\d{2})$/);
      const value = part.match(/^(\d+(?:\.\d+)?)(?: ([A-Z]{3}))?$/);
      if (closed) o.closed = closed[1];
      else if (value) {
        o.value = Number(value[1]);
        if (value[2]) o.currency = value[2];
      } else if (part.startsWith("reason: ")) o.reason = part.slice(8);
    }
    out.push(o);
    i++;
  }
  return out;
}

// Replace one account's line, or add it. A changed outcome goes back to unconfirmed.
export function upsertOutcome(md: string, o: Omit<OutcomeLine, "confirmed">): { md: string; keptConfirmation: boolean } {
  const existing = parseOutcomes(md).find((x) => x.account === o.account);
  const keep = existing?.confirmed === true && existing.outcome === o.outcome;
  const line = formatOutcome({ ...o, confirmed: keep });
  if (!existing) return { md: `${(md || OUTCOMES_HEADER).replace(/\n*$/, "\n")}\n${line}\n`.replace(/\n\n\n+/g, "\n\n"), keptConfirmation: false };
  const old = formatOutcome(existing);
  return { md: md.replace(old, line), keptConfirmation: keep };
}
