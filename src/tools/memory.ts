// Memory tools: list, read, write, add a signal, search. Everything stays inside the data folder.
// Every write that adds a signal runs quote.check; signals whose quote isn't in their source are dropped.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { quoteCheck } from "../checks/quote.js";
import { commit, ensureDataFolder, safePath } from "../data/folder.js";
import { indexFile, openIndex, search, type Hit } from "../index/search.js";
import { newPromises } from "../memory/promises.js";
import { formatSignal, newSignals, type Signal } from "../memory/signals.js";
import { dataBlock } from "../server/data-block.js";

export interface MemoryDeps {
  dir: string;
  // Plain text of a signal's source (gmail/thread/<id>, drive/file/<id>, calendar/event/<id>), or null.
  sourceText: (source: string) => Promise<string | null>;
}

export interface WriteResult {
  path: string;
  created: boolean;
  keptSignals: number;
  keptPromises: number;
  dropped: string[];
  notes: string[];
}

const MAX_QUOTE = 400;
const today = () => new Date().toISOString().slice(0, 10);

export async function memoryList(deps: MemoryDeps, sub = ""): Promise<string> {
  const notes = await prepare(deps);
  const { abs, rel } = sub ? safePath(deps.dir, sub) : { abs: deps.dir, rel: "" };
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return `${rel || "."} is not a folder.`;
  const out: string[] = [];
  const walk = (d: string, prefix: string, depth: number) => {
    for (const name of readdirSync(d).sort()) {
      if (name.startsWith(".") || name === "index.sqlite" || name.startsWith("index.sqlite-")) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) {
        out.push(`${prefix}${name}/`);
        if (depth < 3) walk(p, `${prefix}${name}/`, depth + 1);
      } else out.push(`${prefix}${name}`);
    }
  };
  walk(abs, rel ? `${rel}/` : "", 0);
  return [...notes, ...out].join("\n");
}

// Memory holds quotes from outside mail, so it comes back inside a data block too.
export async function memoryRead(deps: MemoryDeps, path: string): Promise<string> {
  await prepare(deps);
  const { abs, rel } = safePath(deps.dir, path);
  if (!existsSync(abs)) return `${rel} doesn't exist yet.`;
  return dataBlock(`memory/${rel}`, readFileSync(abs, "utf8"));
}

export async function memoryWrite(
  deps: MemoryDeps,
  input: { path: string; content: string; mode: "replace" | "append" },
  message?: string,
): Promise<WriteResult> {
  const notes = await prepare(deps);
  const { abs, rel } = safePath(deps.dir, input.path, { write: true });
  const created = !existsSync(abs);
  const prev = created ? "" : readFileSync(abs, "utf8");
  let next = input.mode === "append" && prev ? `${prev.replace(/\n*$/, "\n")}${input.content.replace(/^\n+/, "")}` : input.content;
  if (!next.endsWith("\n")) next += "\n";

  guardContent(next);

  const { added, malformed } = newSignals(prev, next);
  if (malformed.length > 0) {
    throw new Error(`These lines look like signals but don't match the format, so nothing was written:\n${malformed.join("\n")}\nUse: - [type] "quote" — Name, YYYY-MM-DD, then "  source: gmail/thread/<id> · status: live".`);
  }
  const dropped: string[] = [];
  for (const s of added) {
    const why = await signalProblem(deps, s);
    if (why) {
      dropped.push(`[${s.type}] "${s.quote}": ${why}`);
      next = next.replace(`${s.text}\n`, "").replace(s.text, "");
    }
  }
  // Promises carry a quote too, and get the same check.
  const promises = newPromises(prev, next);
  if (promises.malformed.length > 0) {
    throw new Error(`These lines look like promises but don't match the format, so nothing was written:\n${promises.malformed.join("\n")}\nUse promise_log to add promises.`);
  }
  for (const p of promises.added) {
    const why = await quoteProblem(deps, p.quote, p.source);
    if (why) {
      dropped.push(`promise "${p.what}": ${why}`);
      next = next.replace(`${p.text}\n`, "").replace(p.text, "");
    }
  }

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, next);
  const db = openIndex(deps.dir);
  try {
    indexFile(db, deps.dir, rel);
  } finally {
    db.close();
  }
  const note = await commit(deps.dir, [rel], message ?? `${created ? "Add" : "Update"} ${rel}`);
  if (note) notes.push(note);
  const keptSignals = added.length - dropped.filter((d) => d.startsWith("[")).length;
  return { path: rel, created, keptSignals, keptPromises: promises.added.length - dropped.filter((d) => d.startsWith("promise ")).length, dropped, notes };
}

export interface NewSignal {
  account: string;
  type: string;
  quote: string;
  who: string;
  date: string;
  source: string;
  expires?: string;
}

// Append one signal under "## Signals" in the account file, creating the file if needed.
export async function addSignal(deps: MemoryDeps, s: NewSignal): Promise<WriteResult> {
  await prepare(deps);
  const slug = accountSlug(s.account);
  const rel = `memory/accounts/${slug}.md`;
  const { abs } = safePath(deps.dir, rel, { write: true });
  const prev = existsSync(abs) ? readFileSync(abs, "utf8") : `# ${s.account}\n\n## Signals\n`;
  const signal: Signal = { type: s.type, quote: s.quote.replace(/^["“]|["”]$/g, ""), who: s.who, date: s.date, source: s.source, ...(s.expires ? { expires: s.expires } : {}), status: "live" };
  const line = formatSignal(signal);
  let next: string;
  const m = prev.match(/^## Signals[^\n]*\n/m);
  if (m && m.index !== undefined) {
    // Insert at the end of the Signals section, before the next "## " heading.
    const start = m.index + m[0].length;
    const rest = prev.slice(start);
    const nextHeading = rest.search(/^## /m);
    const end = nextHeading < 0 ? prev.length : start + nextHeading;
    next = `${prev.slice(0, end).replace(/\n*$/, "\n")}${line}\n${nextHeading < 0 ? "" : `\n${prev.slice(end)}`}`;
  } else {
    next = `${prev.replace(/\n*$/, "\n")}\n## Signals\n${line}\n`;
  }
  return memoryWrite(deps, { path: rel, content: next, mode: "replace" }, `Signal for ${s.account}: ${s.type}`);
}

export async function memorySearch(deps: MemoryDeps, query: string, limit: number): Promise<Hit[]> {
  await prepare(deps);
  return search(deps.dir, query, limit);
}

export const accountSlug = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "") || "account";

async function prepare(deps: MemoryDeps): Promise<string[]> {
  return (await ensureDataFolder(deps.dir)) ? [`Created your data folder at ${deps.dir}.`] : [];
}

async function signalProblem(deps: MemoryDeps, s: Signal): Promise<string | null> {
  if (s.date > today()) return "the date is in the future.";
  return quoteProblem(deps, s.quote, s.source);
}

// Why a quote can't be stored, or null when it's found word for word in its source.
export async function quoteProblem(deps: MemoryDeps, quote: string, source: string): Promise<string | null> {
  if (quote.length > MAX_QUOTE) return `the quote is over ${MAX_QUOTE} characters; keep the words that matter.`;
  const text = await deps.sourceText(source).catch(() => null);
  if (text === null) return `couldn't read the source ${source}.`;
  return quoteCheck(quote, text) ? null : `the quote isn't in ${source} word for word.`;
}

// Memory keeps quotes and facts, never whole emails or tool output.
function guardContent(text: string): void {
  if (/<<<\s*(END_)?OUTSIDE[_-]DATA/i.test(text)) throw new Error("Nothing was written: the content has a raw data block in it. Store quotes and facts, not tool output.");
  const headerLines = text.match(/^(?:From|To|Cc|Subject|Date|Message-ID):\s.+$/gim) ?? [];
  if (headerLines.length >= 3) throw new Error("Nothing was written: the content looks like a pasted email. Store quotes and facts, not whole emails.");
}
