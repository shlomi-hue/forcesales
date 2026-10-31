// The user's data folder: where it is, creating it from the template, safe paths, git commits.

import { execFile } from "node:child_process";
import { cpSync, existsSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

// Works from src/data (tests) and dist/data (the package): both sit two levels below the root.
export const TEMPLATE_DIR = fileURLToPath(new URL("../../templates/data", import.meta.url));

export function dataDir(env: NodeJS.ProcessEnv = process.env): string {
  const d = env.DEAL_HARNESS_DATA?.trim();
  if (!d) return join(homedir(), "deal-harness-data");
  return d.startsWith("~") ? join(homedir(), d.slice(1)) : resolve(d);
}

// Files the harness reads but never writes: its rules belong to the user.
export const PROTECTED = ["memory/lessons/accepted.md", "company/playbook.md", "config.md", "config.local.md"];

// Files only harness code writes: outcomes (so only the user can confirm them) and numbers computed in code.
export const TOOL_ONLY: Record<string, string> = {
  "memory/history/outcomes.md": "outcome_log",
  "memory/history/baseline.md": "history_stats",
  "company/icp-map.md": "history_stats",
  "memory/history/calibration.md": "calibration_score",
  "memory/lessons/proposed.md": "lessons_learn or lesson_propose",
};
const TOOL_ONLY_PATTERNS: [RegExp, string][] = [
  [/^memory\/deals\/[^/]+\/probabilities\.md$/, "probability_set"],
  [/^memory\/edits\//, "edits_capture"],
];
const toolFor = (r: string) => TOOL_ONLY[r] ?? TOOL_ONLY_PATTERNS.find(([re]) => re.test(r))?.[1];

// Create the folder from the template on first use. Returns true when it was just created.
export async function ensureDataFolder(dir: string): Promise<boolean> {
  if (existsSync(join(dir, "config.md"))) return false;
  cpSync(TEMPLATE_DIR, dir, { recursive: true, errorOnExist: false, force: false });
  // npm drops files named .gitignore from packages, so the template ships it as "gitignore".
  if (existsSync(join(dir, "gitignore"))) renameSync(join(dir, "gitignore"), join(dir, ".gitignore"));
  // A new folder starts at the current format (see migrations.ts; kept in step by a test).
  writeFileSync(join(dir, ".deal-harness-format"), `${DATA_FORMAT}\n`);
  if (await hasGit()) {
    if (!existsSync(join(dir, ".git"))) await git(dir, "init", "-q");
    await commit(dir, ["."], "Start deal harness data folder");
  }
  return true;
}

// Resolve a path the agent gave, relative to the data folder. Refuses anything outside it.
export function safePath(dir: string, rel: string, opts: { write?: boolean; internal?: boolean } = {}): { abs: string; rel: string } {
  const cleaned = normalize(rel.trim().replace(/\\/g, "/")).replace(/^(\.\/)+/, "");
  if (!cleaned || isAbsolute(cleaned)) throw new Error(`Give a path inside the data folder, like memory/accounts/acme.md (got "${rel}").`);
  const abs = resolve(dir, cleaned);
  const back = relative(dir, abs);
  if (back.startsWith("..") || isAbsolute(back)) throw new Error(`"${rel}" is outside the data folder.`);
  const r = back.split(sep).join("/");
  if (r.split("/").some((part) => part.startsWith("."))) throw new Error(`"${rel}" is a hidden path.`);
  if (opts.write) {
    if (!r.endsWith(".md")) throw new Error("Memory files are markdown: the path must end in .md.");
    if (PROTECTED.includes(r)) throw new Error(`${r} belongs to you; the harness never changes it. Propose changes in memory/lessons/proposed.md.`);
    const tool = toolFor(r);
    if (tool && !opts.internal) throw new Error(`${r} is written only by ${tool}, so its contents can be trusted. Use that tool.`);
    if (!/^(memory|company)\//.test(r)) throw new Error("Writes go under memory/ or company/.");
  }
  return { abs, rel: r };
}

export const DATA_FORMAT = 1;

let gitAvailable: boolean | null = null;
async function hasGit(): Promise<boolean> {
  if (gitAvailable === null) gitAvailable = await run("git", ["--version"]).then(() => true, () => false);
  return gitAvailable;
}

const git = (dir: string, ...args: string[]) => run("git", ["-C", dir, ...args]);

// Commit the given paths. Returns a note when it couldn't, rather than failing the write.
export async function commit(dir: string, paths: string[], message: string): Promise<string | null> {
  if (!(await hasGit())) return "git isn't installed, so this change isn't versioned.";
  if (!existsSync(join(dir, ".git"))) return "the data folder isn't a git repo, so this change isn't versioned.";
  try {
    await git(dir, "add", "--", ...paths);
    const staged = await git(dir, "diff", "--cached", "--quiet").then(() => false, () => true);
    if (!staged) return null;
    await git(dir, "-c", "user.name=deal-harness", "-c", "user.email=deal-harness@localhost", "commit", "-q", "-m", message);
    return null;
  } catch (err) {
    return `git commit failed: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`;
  }
}
