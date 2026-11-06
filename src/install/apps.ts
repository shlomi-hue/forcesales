// Where each agent app keeps its MCP servers and skills, and how to add or remove the harness
// there. Paths come from each app's own docs or source (checked 2026-10-31):
//   Claude Code     `claude mcp add -s user`; skills in ~/.claude/skills/
//   Claude Desktop  claude_desktop_config.json "mcpServers"; skills are uploaded in the app as zips
//   Codex           $CODEX_HOME/config.toml (default ~/.codex) [mcp_servers.<name>]; skills in ~/.agents/skills/
//   Gemini CLI      ~/.gemini/settings.json "mcpServers"; skills in ~/.gemini/skills/ or ~/.agents/skills/
// File edits here are pure: they take the file's text and return the new text.

import { join } from "node:path";

export const SERVER_NAME = "deal-harness";

export type AppId = "claude-code" | "claude-desktop" | "codex" | "gemini";
export const APPS: AppId[] = ["claude-code", "claude-desktop", "codex", "gemini"];
export const APP_NAMES: Record<AppId, string> = { "claude-code": "Claude Code", "claude-desktop": "Claude Desktop", codex: "Codex", gemini: "Gemini CLI" };

export interface Place {
  home: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
}

export interface ServerCommand {
  command: string;
  args: string[];
  // Only set when the data folder isn't the default one.
  env?: Record<string, string>;
}

export const harnessHome = (p: Place) => p.env.DEAL_HARNESS_HOME?.trim() || join(p.home, ".deal-harness");

export function desktopConfigDir(p: Place): string | null {
  if (p.platform === "darwin") return join(p.home, "Library", "Application Support", "Claude");
  if (p.platform === "win32") return join(p.env.APPDATA ?? join(p.home, "AppData", "Roaming"), "Claude");
  // No official Linux app; community builds use ~/.config/Claude.
  return join(p.env.XDG_CONFIG_HOME ?? join(p.home, ".config"), "Claude");
}

export const codexHome = (p: Place) => p.env.CODEX_HOME?.trim() || join(p.home, ".codex");

export function configFile(app: AppId, p: Place): string | null {
  if (app === "claude-desktop") {
    const d = desktopConfigDir(p);
    return d ? join(d, "claude_desktop_config.json") : null;
  }
  if (app === "codex") return join(codexHome(p), "config.toml");
  if (app === "gemini") return join(p.home, ".gemini", "settings.json");
  return null; // Claude Code is set up through its CLI.
}

// Where file-based skills go. Desktop has none: its skills are uploaded in the app.
export function skillsDir(app: AppId, p: Place): string | null {
  if (app === "claude-code") return join(p.home, ".claude", "skills");
  if (app === "codex" || app === "gemini") return join(p.home, ".agents", "skills");
  return null;
}

// ---------- JSON configs (Claude Desktop, Gemini CLI) ----------

type Json = Record<string, unknown>;

function parseJsonConfig(text: string, file: string): Json {
  if (!text.trim()) return {};
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object" && !Array.isArray(v)) return v as Json;
  } catch {
    // fall through
  }
  throw new Error(`${file} isn't plain JSON (it may have comments), so it wasn't changed. Add the server by hand.`);
}

export function addJsonServer(text: string, file: string, cmd: ServerCommand, extra: Json = {}): string {
  const cfg = parseJsonConfig(text, file);
  const servers = (cfg.mcpServers && typeof cfg.mcpServers === "object" ? cfg.mcpServers : {}) as Json;
  servers[SERVER_NAME] = { command: cmd.command, args: cmd.args, ...(cmd.env ? { env: cmd.env } : {}), ...extra };
  cfg.mcpServers = servers;
  return `${JSON.stringify(cfg, null, 2)}\n`;
}

export function removeJsonServer(text: string, file: string): { text: string; removed: boolean } {
  const cfg = parseJsonConfig(text, file);
  const servers = cfg.mcpServers as Json | undefined;
  if (!servers || !(SERVER_NAME in servers)) return { text, removed: false };
  delete servers[SERVER_NAME];
  return { text: `${JSON.stringify(cfg, null, 2)}\n`, removed: true };
}

export function jsonServer(text: string, file: string): ServerCommand | null {
  const s = ((parseJsonConfig(text, file).mcpServers ?? {}) as Json)[SERVER_NAME] as Partial<ServerCommand> | undefined;
  return s?.command ? { command: s.command, args: s.args ?? [] } : null;
}

// ---------- Codex config.toml ----------

const TABLE = `[mcp_servers.${SERVER_NAME}]`;
// JSON strings are valid TOML basic strings.
const tomlString = (s: string) => JSON.stringify(s);

// The [mcp_servers.deal-harness] table: from its header to the next table header or the end.
function tableRange(lines: string[]): [number, number] | null {
  const start = lines.findIndex((l) => l.trim() === TABLE || l.trim() === `[mcp_servers."${SERVER_NAME}"]`);
  if (start < 0) return null;
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end] ?? "")) end++;
  // Keep a blank line that separates it from the next table.
  while (end > start + 1 && !(lines[end - 1] ?? "").trim()) end--;
  return [start, end];
}

export function removeTomlServer(text: string): { text: string; removed: boolean } {
  const lines = text.split("\n");
  const r = tableRange(lines);
  if (!r) return { text, removed: false };
  lines.splice(r[0], r[1] - r[0]);
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n"), removed: true };
}

export function addTomlServer(text: string, cmd: ServerCommand): string {
  const base = removeTomlServer(text).text.replace(/\s*$/, "");
  const env = cmd.env ? [`env = { ${Object.entries(cmd.env).map(([k, v]) => `${tomlString(k)} = ${tomlString(v)}`).join(", ")} }`] : [];
  const table = [TABLE, `command = ${tomlString(cmd.command)}`, `args = [${cmd.args.map(tomlString).join(", ")}]`, ...env].join("\n");
  return `${base ? `${base}\n\n` : ""}${table}\n`;
}

export function tomlServer(text: string): ServerCommand | null {
  const lines = text.split("\n");
  const r = tableRange(lines);
  if (!r) return null;
  const body = lines.slice(r[0] + 1, r[1]).join("\n");
  const command = body.match(/^\s*command\s*=\s*("(?:[^"\\]|\\.)*")/m)?.[1];
  const args = body.match(/^\s*args\s*=\s*(\[[^\]]*\])/m)?.[1];
  if (!command) return null;
  try {
    return { command: JSON.parse(command) as string, args: args ? (JSON.parse(args) as string[]) : [] };
  } catch {
    return null;
  }
}

// ---------- Claude Code CLI ----------

export const claudeAddArgs = (cmd: ServerCommand) => [
  "mcp", "add", "-s", "user",
  ...Object.entries(cmd.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
  SERVER_NAME, "--", cmd.command, ...cmd.args,
];
export const claudeRemoveArgs = () => ["mcp", "remove", "-s", "user", SERVER_NAME];
