// quote.check: a signal's quote must appear word for word in its source.
// Spacing, curly quotes and dash styles are ignored; "..." may join pieces that appear in order. Pure.

const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim();

export function quoteCheck(quote: string, source: string): boolean {
  const pieces = normalize(quote)
    .replace(/^["']|["']$/g, "")
    .split(/\s*(?:\.\.\.|…)\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (pieces.length === 0 || pieces.join(" ").length < 3) return false;
  const src = normalize(source);
  let from = 0;
  for (const piece of pieces) {
    const at = src.indexOf(piece, from);
    if (at < 0) return false;
    from = at + piece.length;
  }
  return true;
}
