// What init, update, doctor and uninstall do to each app, with the outside world passed in
// (home folder, platform, a way to run commands) so tests can use a temp home.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  addJsonServer, addTomlServer, APP_NAMES, claudeAddArgs, claudeRemoveArgs, codexHome, configFile, desktopConfigDir,
  harnessHome, jsonServer, removeJsonServer, removeTomlServer, skillsDir, tomlServer,
  type AppId, type Place, type ServerCommand,
} from "./apps.js";
import { installSkills, removeSkills, staleSkills, zipSkills } from "./skills.js";

export type Runner = (cmd: string, args: string[]) => { ok: boolean; out: string };

export interface SetupDeps {
  place: Place;
  run: Runner;
  skillsSource: string;
  version: string;
}

const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
const write = (f: string, text: string) => {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, text);
};
const hasCommand = (d: SetupDeps, cmd: string) => d.run(cmd, ["--version"]).ok;

export function detect(d: SetupDeps): Record<AppId, boolean> {
  const p = d.place;
  return {
    "claude-code": hasCommand(d, "claude"),
    "claude-desktop": (p.platform === "darwin" || p.platform === "win32" || p.platform === "linux") && existsSync(desktopConfigDir(p) ?? "\0"),
    codex: existsSync(codexHome(p)) || hasCommand(d, "codex"),
    gemini: existsSync(join(p.home, ".gemini")) || hasCommand(d, "gemini"),
  };
}

export const desktopZipDir = (p: Place) => join(harnessHome(p), "desktop-skills");

// Add the MCP entry and skills for one app. Returns plain lines for the user.
export function configure(app: AppId, d: SetupDeps, cmd: ServerCommand, skillDirsDone: Set<string>): string[] {
  const name = APP_NAMES[app];
  const out: string[] = [];
  if (app === "claude-code") {
    d.run("claude", claudeRemoveArgs());
    const r = d.run("claude", claudeAddArgs(cmd));
    if (!r.ok) return [`${name}: couldn't add the server: ${r.out.trim().split("\n")[0]}`];
    out.push(`${name}: added the deal-harness server (user scope).`);
  } else {
    const file = configFile(app, d.place) as string;
    const text = read(file);
    write(file, app === "codex" ? addTomlServer(text, cmd) : addJsonServer(text, file, cmd));
    out.push(`${name}: added the deal-harness server to ${file}.`);
    if (app === "gemini") out.push(`${name}: it only starts servers in folders you trust. When it asks, trust the folder you work in.`);
  }
  if (app === "claude-desktop") {
    const zips = zipSkills(d.skillsSource, desktopZipDir(d.place));
    out.push(`${name}: skills can't be installed from outside the app. Upload the ${zips.length} zips in ${desktopZipDir(d.place)} under Settings → Capabilities → Skills, then restart Claude Desktop.`);
    return out;
  }
  const dest = skillsDir(app, d.place) as string;
  if (!skillDirsDone.has(dest)) {
    skillDirsDone.add(dest);
    const r = installSkills(d.skillsSource, dest, d.version);
    out.push(`${name}: ${r.installed.length} skills in ${dest}.`);
    if (r.skipped.length) out.push(`${name}: left alone, because you already have skills with these names: ${r.skipped.join(", ")}.`);
  } else out.push(`${name}: uses the same skills folder, ${dest}.`);
  return out;
}

export function unconfigure(app: AppId, d: SetupDeps, skillDirsDone: Set<string>): string[] {
  const name = APP_NAMES[app];
  const out: string[] = [];
  if (app === "claude-code") {
    if (hasCommand(d, "claude") && d.run("claude", claudeRemoveArgs()).ok) out.push(`${name}: removed the server.`);
  } else {
    const file = configFile(app, d.place) as string;
    if (existsSync(file)) {
      const r = app === "codex" ? removeTomlServer(read(file)) : removeJsonServer(read(file), file);
      if (r.removed) {
        write(file, r.text);
        out.push(`${name}: removed the server from ${file}.`);
      }
    }
  }
  const dest = skillsDir(app, d.place);
  if (dest && !skillDirsDone.has(dest)) {
    skillDirsDone.add(dest);
    const removed = existsSync(dest) ? removeSkills(d.skillsSource, dest) : [];
    if (removed.length) out.push(`${name}: removed ${removed.length} skills from ${dest}.`);
  }
  if (app === "claude-desktop" && existsSync(desktopZipDir(d.place))) out.push(`${name}: remove the uploaded skills in Settings → Capabilities → Skills.`);
  return out;
}

export interface Check {
  ok: boolean;
  warn?: boolean;
  text: string;
}

// The entry each app has for the server now, if any.
export function currentEntry(app: AppId, d: SetupDeps): ServerCommand | null | "unknown" {
  if (app === "claude-code") {
    const r = d.run("claude", ["mcp", "get", "deal-harness"]);
    if (!r.ok) return null;
    const cmd = r.out.match(/Command:\s*(.+)/)?.[1]?.trim();
    const args = r.out.match(/Args:\s*(.*)/)?.[1]?.trim();
    // Args print space-joined, so keep the line whole: paths can have spaces in them.
    return cmd ? { command: cmd, args: args ? [args] : [] } : "unknown";
  }
  const file = configFile(app, d.place) as string;
  if (!existsSync(file)) return null;
  try {
    return app === "codex" ? tomlServer(read(file)) : jsonServer(read(file), file);
  } catch {
    return "unknown";
  }
}

export function checkApp(app: AppId, d: SetupDeps, want: ServerCommand): Check[] {
  const name = APP_NAMES[app];
  const checks: Check[] = [];
  const entry = currentEntry(app, d);
  const fix = "run `deal-harness init` again";
  if (entry === null) checks.push({ ok: false, text: `${name}: no deal-harness server set up (${fix}).` });
  else if (entry === "unknown") checks.push({ ok: true, warn: true, text: `${name}: has a deal-harness server, but its command couldn't be read.` });
  else if (entry.command !== want.command || entry.args.join(" ") !== want.args.join(" ")) {
    checks.push({ ok: false, text: `${name}: the server points at ${[entry.command, ...entry.args].join(" ")}, not this install (${fix}).` });
  } else checks.push({ ok: true, text: `${name}: server set up.` });
  const dest = skillsDir(app, d.place);
  if (dest) {
    const s = staleSkills(d.skillsSource, dest);
    if (s.missing.length || s.outdated.length) checks.push({ ok: false, text: `${name}: skills ${[...s.missing.map((x) => `${x} (missing)`), ...s.outdated.map((x) => `${x} (old)`)].join(", ")} (${fix}).` });
    else checks.push({ ok: true, text: `${name}: skills up to date in ${dest}.` });
    if (s.notOurs.length) checks.push({ ok: true, warn: true, text: `${name}: you have your own skills named ${s.notOurs.join(", ")}, so the harness's aren't used there.` });
  }
  return checks;
}
