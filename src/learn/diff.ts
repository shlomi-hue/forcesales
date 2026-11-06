// Word diff between the draft the harness wrote and the email the user sent. Pure.
// Changes come back as hunks: words cut, words added, or words changed into others.

export interface Hunk {
  removed: string;
  added: string;
}

// Past this many words a side, a diff is too slow to matter: count it as a rewrite.
const MAX_WORDS = 1500;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

// Line breaks are tokens too, so edits on neighbouring lines ("...any questions." then "Best
// regards,") stay separate hunks. They never show up in a hunk's text.
const BREAK = "\n";
const tokens = (s: string) => s.replace(/\r/g, "").split(/[ \t]*(\n)[\s]*|[ \t]+/).filter((t): t is string => !!t);
const text = (ts: string[]) => ts.filter((t) => t !== BREAK).join(" ");

// Lower case, no outer punctuation or quotes, single spaces: how phrases are compared.
export function normPhrase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .trim();
}

const key = (w: string) => normPhrase(w) || w;

export function wordDiff(before: string, after: string): Hunk[] {
  const a = tokens(before.trim());
  const b = tokens(after.trim());
  if (a.length > MAX_WORDS || b.length > MAX_WORDS) return text(a) === text(b) ? [] : [{ removed: text(a), added: text(b) }];
  const ka = a.map(key);
  const kb = b.map(key);
  // Longest common subsequence table, filled from the end.
  const lcs: Uint16Array[] = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    const row = lcs[i] as Uint16Array;
    const below = lcs[i + 1] as Uint16Array;
    for (let j = b.length - 1; j >= 0; j--) {
      row[j] = ka[i] === kb[j] ? (below[j + 1] ?? 0) + 1 : Math.max(below[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  // Walk the table into hunks, keeping the shared words between them so close hunks can merge.
  const parts: (Hunk & { gap: string[] })[] = [];
  let gap: string[] = [];
  let rem: string[] = [];
  let add: string[] = [];
  const flush = () => {
    if (rem.some((t) => t !== BREAK) || add.some((t) => t !== BREAK)) {
      parts.push({ removed: text(rem), added: text(add), gap });
      gap = [];
    }
    rem = [];
    add = [];
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ka[i] === kb[j]) {
      flush();
      gap.push(b[j] as string);
      i++;
      j++;
    } else if (j < b.length && (i >= a.length || (lcs[i]?.[j + 1] ?? 0) >= (lcs[i + 1]?.[j] ?? 0))) {
      add.push(b[j++] as string);
    } else {
      rem.push(a[i++] as string);
    }
  }
  flush();
  // A word or two in common inside one sentence ("Let me know if YOU have any questions" → "Can YOU
  // confirm by Friday") doesn't split an edit: merge across it.
  const hunks: Hunk[] = [];
  for (const [n, p] of parts.entries()) {
    const prev = hunks.at(-1);
    const ends = (w: string | undefined) => !!w && (w === BREAK || /[.!?:;]["')\]]*$/.test(w));
    const joinable = n > 0 && p.gap.length > 0 && p.gap.length <= 2 && !p.gap.some(ends) && !ends(prev?.removed.split(" ").at(-1)) && !ends(prev?.added.split(" ").at(-1));
    if (prev && joinable) {
      const g = text(p.gap);
      prev.removed = [prev.removed, g, p.removed].filter(Boolean).join(" ");
      prev.added = [prev.added, g, p.added].filter(Boolean).join(" ");
    } else hunks.push({ removed: p.removed, added: p.added });
  }
  return hunks;
}

export const wordCount = (s: string) => words(s).length;
