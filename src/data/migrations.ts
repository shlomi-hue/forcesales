// Data folder format and its migrations. The format number lives in <data>/.deal-harness-format,
// a hidden file the agent's tools can't touch. Migrations only add: they never overwrite or
// delete the user's files.

import { execFile } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { commit, TEMPLATE_DIR } from "./folder.js";

export const FORMAT_FILE = ".deal-harness-format";

export function readFormat(dir: string): number {
  const f = join(dir, FORMAT_FILE);
  if (!existsSync(f)) return 0;
  const n = Number(readFileSync(f, "utf8").trim());
  return Number.isInteger(n) ? n : 0;
}

const walk = (d: string): string[] =>
  readdirSync(d).flatMap((n) => {
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// Template files the folder doesn't have yet (new skills' files, new memory folders).
function addMissingTemplateFiles(dir: string): string[] {
  const added: string[] = [];
  for (const src of walk(TEMPLATE_DIR)) {
    const rel = relative(TEMPLATE_DIR, src).split("\\").join("/");
    if (rel === "gitignore") continue;
    const dest = join(dir, rel);
    if (existsSync(dest)) continue;
    cpSync(src, dest);
    added.push(rel);
  }
  return added;
}

// Lines from the template's .gitignore that the folder's .gitignore lacks.
function mergeGitignore(dir: string): string[] {
  const want = readFileSync(join(TEMPLATE_DIR, "gitignore"), "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  const file = join(dir, ".gitignore");
  const have = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = new Set(have.split("\n").map((l) => l.trim()));
  const missing = want.filter((l) => !lines.has(l));
  if (missing.length) writeFileSync(file, `${have.replace(/\n*$/, have ? "\n" : "")}${missing.join("\n")}\n`);
  return missing;
}

// Stop tracking a file git already has, now that .gitignore lists it. Its old versions stay in history.
async function untrack(dir: string, rel: string): Promise<string[]> {
  if (!existsSync(join(dir, ".git"))) return [];
  const git = (...a: string[]) => promisify(execFile)("git", ["-C", dir, ...a]);
  const tracked = await git("ls-files", "--error-unmatch", rel).then(() => true, () => false);
  if (!tracked) return [];
  await git("rm", "--cached", "-q", rel);
  return [`untracked ${rel} in git (old versions stay in the history)`];
}

interface Migration {
  to: number;
  what: string;
  run: (dir: string) => Promise<string[]>;
}

// Each step brings the folder up to `to`. Steps run in order and are safe to run twice.
export const MIGRATIONS: Migration[] = [
  {
    to: 1,
    what: "ignore memory/edits/pending.json (whole drafts) in git, and add new template files",
    run: async (dir) => [
      ...mergeGitignore(dir).map((l) => `.gitignore: ${l}`),
      ...(await untrack(dir, "memory/edits/pending.json")),
      ...addMissingTemplateFiles(dir),
    ],
  },
];
export const CURRENT_FORMAT = MIGRATIONS.at(-1)?.to ?? 0;

export function stampFormat(dir: string): void {
  writeFileSync(join(dir, FORMAT_FILE), `${CURRENT_FORMAT}\n`);
}

export async function migrate(dir: string): Promise<{ from: number; to: number; changes: string[] }> {
  const from = readFormat(dir);
  const changes: string[] = [];
  for (const m of MIGRATIONS.filter((x) => x.to > from)) {
    for (const c of await m.run(dir)) changes.push(c);
  }
  if (from < CURRENT_FORMAT) stampFormat(dir);
  if (changes.length) await commit(dir, ["."], `Update data folder to format ${CURRENT_FORMAT}`);
  return { from, to: Math.max(from, CURRENT_FORMAT), changes };
}
