// The signal line format, used everywhere:
//   - [budget] "we have Q1 money set aside" — Dana Lee, 2026-10-02
//     source: gmail/thread/<id> · expires: 2027-01-02 · status: live

export interface Signal {
  type: string;
  quote: string;
  who: string;
  date: string;
  source: string;
  expires?: string;
  status: string;
}

const HEAD = /^- \[([\w-]+)\] "(.+)" — (.+), (\d{4}-\d{2}-\d{2})\s*$/;
const TAIL = /^\s+source: (\S+)(?: · expires: (\d{4}-\d{2}-\d{2}))?(?: · status: ([\w-]+))?\s*$/;
// A line that starts like a signal, so a malformed one can't sneak past the quote check.
const LOOKS_LIKE = /^- \[[\w-]+\] ["“]/;

export function formatSignal(s: Signal): string {
  const tail = [`source: ${s.source}`, ...(s.expires ? [`expires: ${s.expires}`] : []), `status: ${s.status}`].join(" · ");
  return `- [${s.type}] "${s.quote}" — ${s.who}, ${s.date}\n  ${tail}`;
}

export interface ParsedSignal extends Signal {
  text: string;
}

// Every signal in a markdown file, plus lines that look like signals but don't parse.
export function parseSignals(markdown: string): { signals: ParsedSignal[]; malformed: string[] } {
  const lines = markdown.split("\n");
  const signals: ParsedSignal[] = [];
  const malformed: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (!LOOKS_LIKE.test(line)) continue;
    const head = line.match(HEAD);
    const tail = (lines[i + 1] ?? "").match(TAIL);
    if (!head || !tail) {
      malformed.push(line);
      continue;
    }
    signals.push({
      type: head[1] ?? "",
      quote: head[2] ?? "",
      who: head[3] ?? "",
      date: head[4] ?? "",
      source: tail[1] ?? "",
      ...(tail[2] ? { expires: tail[2] } : {}),
      status: tail[3] ?? "live",
      text: `${line}\n${lines[i + 1]}`,
    });
    i++;
  }
  return { signals, malformed };
}

const key = (s: Signal) => `${s.type}|${s.quote}|${s.source}`;

// Signals in `next` that weren't already in `prev`.
export function newSignals(prev: string, next: string): { added: ParsedSignal[]; malformed: string[] } {
  const before = new Set(parseSignals(prev).signals.map(key));
  const before_bad = new Set(parseSignals(prev).malformed);
  const after = parseSignals(next);
  return {
    added: after.signals.filter((s) => !before.has(key(s))),
    malformed: after.malformed.filter((m) => !before_bad.has(m)),
  };
}
