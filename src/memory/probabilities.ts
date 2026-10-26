// memory/deals/<account>/probabilities.md: the harness's win probability for a deal over time.
// Append-only and written only by probability_set, so calibration scores the real record.
//   - 2026-10-26 · 35% · prior 41% (logistics/200-1000, 12 deals) · why: champion strong, CFO unconvinced

export interface ProbabilityEntry {
  date: string;
  p: number;
  prior?: string;
  why: string;
}

const LINE = /^- (\d{4}-\d{2}-\d{2}) · (\d{1,3})%(?: · prior ([^·]+?))? · why: (.+)$/;

export function formatProbability(e: ProbabilityEntry): string {
  return `- ${e.date} · ${Math.round(e.p * 100)}%${e.prior ? ` · prior ${e.prior}` : ""} · why: ${e.why.replace(/\n/g, " ").trim()}`;
}

export function parseProbabilities(md: string): ProbabilityEntry[] {
  return md
    .split("\n")
    .map((l) => l.match(LINE))
    .filter((m): m is RegExpMatchArray => m !== null)
    .map((m) => ({ date: m[1] ?? "", p: Number(m[2]) / 100, ...(m[3] ? { prior: m[3].trim() } : {}), why: m[4] ?? "" }));
}
