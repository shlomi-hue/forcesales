// Promise lines in memory/deals/<account>/promises.md:
//   - [ ] 2026-11-03 · them · Dana Lee: send the security questionnaire
//     quote: "I'll send it over by Monday" · source: gmail/thread/<id> · logged: 2026-10-28
// "us" means the user promised it; "them" means the buyer did.

export interface DealPromise {
  done: boolean;
  due: string;
  owner: "us" | "them";
  who: string;
  what: string;
  quote: string;
  source: string;
  logged: string;
  doneOn?: string;
}

const HEAD = /^- \[( |x)\] (\d{4}-\d{2}-\d{2}) · (us|them) · ([^:]+): (.+)$/;
const TAIL = /^\s+quote: "(.+)" · source: (\S+) · logged: (\d{4}-\d{2}-\d{2})(?: · done: (\d{4}-\d{2}-\d{2}))?\s*$/;
const LOOKS_LIKE = /^- \[( |x)\] \d{4}-\d{2}-\d{2} · /;

export function formatPromise(p: DealPromise): string {
  const tail = `quote: "${p.quote}" · source: ${p.source} · logged: ${p.logged}${p.doneOn ? ` · done: ${p.doneOn}` : ""}`;
  return `- [${p.done ? "x" : " "}] ${p.due} · ${p.owner} · ${p.who}: ${p.what}\n  ${tail}`;
}

export interface ParsedPromise extends DealPromise {
  text: string;
}

export function parsePromises(markdown: string): { promises: ParsedPromise[]; malformed: string[] } {
  const lines = markdown.split("\n");
  const promises: ParsedPromise[] = [];
  const malformed: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!LOOKS_LIKE.test(line)) continue;
    const h = line.match(HEAD);
    const t = (lines[i + 1] ?? "").match(TAIL);
    if (!h || !t) {
      malformed.push(line);
      continue;
    }
    promises.push({
      done: h[1] === "x",
      due: h[2] ?? "",
      owner: h[3] as "us" | "them",
      who: (h[4] ?? "").trim(),
      what: (h[5] ?? "").trim(),
      quote: t[1] ?? "",
      source: t[2] ?? "",
      logged: t[3] ?? "",
      ...(t[4] ? { doneOn: t[4] } : {}),
      text: `${line}\n${lines[i + 1]}`,
    });
    i++;
  }
  return { promises, malformed };
}

// Identity ignores done/open, so ticking a promise off isn't a new promise.
const key = (p: DealPromise) => `${p.due}|${p.owner}|${p.who}|${p.what}|${p.quote}|${p.source}`;

export function newPromises(prev: string, next: string): { added: ParsedPromise[]; malformed: string[] } {
  const before = new Set(parsePromises(prev).promises.map(key));
  const beforeBad = new Set(parsePromises(prev).malformed);
  const after = parsePromises(next);
  return { added: after.promises.filter((p) => !before.has(key(p))), malformed: after.malformed.filter((m) => !beforeBad.has(m)) };
}

// Whole days from `from` to `to` (both YYYY-MM-DD). Computed here, never by the model.
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
