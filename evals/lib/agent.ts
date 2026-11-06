// Runs Claude Code headless against the harness, for the agent-scored sets.
// Opt-in (EVAL_AGENT=1): each run costs model time and money.

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { ServerDeps } from "../../src/server/server.js";
import { httpServer } from "./fixtures.js";

const CLAUDE = process.env.EVAL_CLAUDE ?? "claude";

export function agentSkip(): string | null {
  if (process.env.EVAL_AGENT !== "1") return "agent part not run (set EVAL_AGENT=1)";
  if (spawnSync(CLAUDE, ["--version"]).status !== 0) return `agent part not run (no \`${CLAUDE}\` command)`;
  return null;
}

// A clean folder with only the shipped skills, so the agent sees what a user's install sees.
function workdir(): string {
  const d = mkdtempSync(join(tmpdir(), "dh-agent-"));
  mkdirSync(join(d, ".claude"), { recursive: true });
  symlinkSync(resolve("skills"), join(d, ".claude", "skills"));
  return d;
}

export async function runAgent(deps: ServerDeps, prompt: string): Promise<{ ok: boolean; out: string }> {
  const srv = await httpServer(deps);
  try {
    const config = JSON.stringify({ mcpServers: { "deal-harness": { type: "http", url: srv.url } } });
    const args = ["-p", prompt, "--mcp-config", config, "--strict-mcp-config", "--allowedTools", "mcp__deal-harness", "Skill"];
    if (process.env.EVAL_MODEL) args.push("--model", process.env.EVAL_MODEL);
    return await new Promise((done) => {
      const child = spawn(CLAUDE, args, { cwd: workdir(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      child.stdout.on("data", (d: Buffer) => (out += d.toString()));
      child.stderr.on("data", (d: Buffer) => (out += d.toString()));
      child.on("error", (e) => done({ ok: false, out: `${out}${e.message}` }));
      child.on("close", (code) => done({ ok: code === 0, out }));
    });
  } finally {
    await srv.close();
  }
}
