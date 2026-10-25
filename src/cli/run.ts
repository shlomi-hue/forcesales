// Unattended runs for the scheduler: the evening /prep and the morning /nag.
// Runs Claude Code headless (`claude -p`) in the harness folder, saves the output in
// <data>/runs/, and shows a desktop notification.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dataDir, ensureDataFolder } from "../data/folder.js";
import { parseSettings } from "../data/settings.js";

export const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(PACKAGE_ROOT, "dist", "cli", "index.js");

export const JOBS = {
  prep: {
    time: "18:00",
    prompt:
      "Use the prep skill for tomorrow's meetings with people outside my company. This is an unattended run: don't ask questions and don't create drafts. Save each brief where the skill says, then print a short summary: one line per meeting with the time, account and the single most important thing to know.",
  },
  nag: {
    time: "08:00",
    prompt:
      "Use the nag skill. This is an unattended run: don't ask questions and don't create drafts. Print the list, worst first, one line per item.",
  },
} as const;

export type Job = keyof typeof JOBS;

export function jobSettings(dir: string): { claude: string; times: Record<Job, string> } {
  const read = (f: string) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : "");
  const s = { ...parseSettings(read("config.md")), ...parseSettings(read("config.local.md")) };
  const time = (v: string | undefined, d: string) => (v && /^\d{1,2}:\d{2}$/.test(v) ? v : d);
  return {
    claude: s["claude command"] || "claude",
    times: { prep: time(s["prep time"], JOBS.prep.time), nag: time(s["nag time"], JOBS.nag.time) },
  };
}

// The MCP config for the headless run: this harness, nothing else.
export function mcpConfig(): string {
  return JSON.stringify({ mcpServers: { "deal-harness": { command: process.execPath, args: [CLI, "serve"] } } });
}

export function claudeArgs(job: Job): string[] {
  return ["-p", JOBS[job].prompt, "--mcp-config", mcpConfig(), "--strict-mcp-config", "--allowedTools", "mcp__deal-harness", "Skill"];
}

export async function runJob(job: Job, log: (s: string) => void): Promise<void> {
  const dir = dataDir();
  await ensureDataFolder(dir);
  const { claude } = jobSettings(dir);
  const started = new Date();
  const { code, out, err } = await new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(claude, claudeArgs(job), { cwd: PACKAGE_ROOT, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", (e) => resolve({ code: -1, out, err: `${err}${e.message}` }));
    child.on("close", (c) => resolve({ code: c, out, err }));
  });

  const stamp = started.toISOString().slice(0, 16).replace(":", "");
  const runs = join(dir, "runs");
  mkdirSync(runs, { recursive: true });
  const file = join(runs, `${stamp}-${job}.md`);
  const ok = code === 0;
  writeFileSync(file, `# ${job} · ${started.toISOString()}\n\n${ok ? out.trim() : `Failed (exit ${code}).\n\n${err.trim()}\n\n${out.trim()}`}\n`);
  log(`${ok ? "Saved" : "Failed, details in"} ${file}`);
  notify(`Deal harness ${job}`, ok ? firstLine(out) || "Done." : `Failed: ${firstLine(err) || "see the run file"}`);
  if (!ok) process.exitCode = 1;
}

const firstLine = (s: string) => s.split("\n").map((l) => l.trim()).find(Boolean)?.slice(0, 200) ?? "";

function notify(title: string, body: string): void {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["osascript", ["-e", `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)}`]]
      : process.platform === "linux"
        ? ["notify-send", [title, body]]
        : [null, []];
  if (!cmd) return;
  try {
    spawn(cmd, args as string[], { stdio: "ignore" }).on("error", () => {}).unref();
  } catch {
    // No notifier; the run file is still saved.
  }
}
