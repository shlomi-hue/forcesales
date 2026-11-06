// `deal-harness init | doctor | update | uninstall`: set the harness up in each agent app,
// check it, bring it up to date, and take it out again. The data folder is never deleted.

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dataDir, ensureDataFolder } from "../data/folder.js";
import { CURRENT_FORMAT, migrate, readFormat } from "../data/migrations.js";
import { loadConfig } from "../data/settings.js";
import { login, readClientSecrets } from "../google/auth.js";
import { keychainStore } from "../google/token-store.js";
import { APP_NAMES, APPS, harnessHome, type AppId, type Place, type ServerCommand } from "../install/apps.js";
import { installedCli, installedRoot, installPackage, PACKAGE_ROOT, packageVersion, removePackage, serverCommand } from "../install/package.js";
import { checkApp, configure, currentEntry, detect, unconfigure, type Check, type Runner, type SetupDeps } from "../install/setup.js";
import { schedule } from "./schedule.js";

type Log = (s: string) => void;

const place = (): Place => ({ home: homedir(), platform: process.platform, env: process.env });

// On Windows the app commands are .cmd shims, which need a shell; quote anything with spaces.
export const runCommand: Runner = (cmd, args) => {
  const win = process.platform === "win32";
  const a = win ? args.map((x) => (/[\s"]/.test(x) ? `"${x.replace(/"/g, '\\"')}"` : x)) : args;
  const r = spawnSync(cmd, a, { encoding: "utf8", shell: win, timeout: 60_000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

const deps = (skillsRoot = PACKAGE_ROOT): SetupDeps => ({ place: place(), run: runCommand, skillsSource: join(skillsRoot, "skills"), version: packageVersion(skillsRoot) ?? "?" });

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) return argv[i + 1];
  return argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}
const has = (argv: string[], name: string) => argv.includes(`--${name}`);

async function ask(q: string, fallback: string, interactive: boolean): Promise<string> {
  if (!interactive) return fallback;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return (await rl.question(q)).trim() || fallback;
  } finally {
    rl.close();
  }
}

// The command apps should run: the installed copy, or this checkout with --here.
function wantedCommand(p: Place, here: boolean): ServerCommand {
  const harness = harnessHome(p);
  const base = here ? { command: process.execPath, args: [join(PACKAGE_ROOT, "dist", "cli", "index.js"), "serve"] } : serverCommand(harness);
  const data = p.env.DEAL_HARNESS_DATA?.trim();
  return data ? { ...base, env: { DEAL_HARNESS_DATA: dataDir(p.env) } } : base;
}

const installedHere = (p: Place) => !existsSync(installedCli(harnessHome(p)));

export async function init(argv: string[], log: Log): Promise<void> {
  const interactive = process.stdin.isTTY === true && !has(argv, "yes");
  const p = place();
  const [major] = process.versions.node.split(".").map(Number);
  if ((major ?? 0) < 20) throw new Error(`Node 20 or newer is needed (this is ${process.versions.node}).`);

  const dataFlag = flag(argv, "data");
  if (dataFlag) p.env.DEAL_HARNESS_DATA = resolve(dataFlag);
  const here = has(argv, "here");

  // 1. The harness's own copy.
  if (!here) installPackage(harnessHome(p), PACKAGE_ROOT, log);
  const root = here ? PACKAGE_ROOT : installedRoot(harnessHome(p));
  const d = deps(root);
  log(`Harness ${d.version} ${here ? `runs from ${PACKAGE_ROOT}` : `installed in ${root}`}.`);

  // 2. The data folder.
  const dir = dataDir(p.env);
  const created = await ensureDataFolder(dir);
  const m = await migrate(dir);
  log(created ? `Created your data folder at ${dir} (a git repo).` : `Data folder: ${dir}${m.changes.length ? ` (updated: ${m.changes.join("; ")})` : ""}.`);

  // 3. The apps.
  const found = detect(d);
  const chosen = (flag(argv, "apps")?.split(",").map((s) => s.trim()) as AppId[] | undefined) ?? APPS.filter((a) => found[a]);
  for (const a of chosen) if (!APPS.includes(a)) throw new Error(`Unknown app "${a}". Use: ${APPS.join(", ")}.`);
  if (chosen.length === 0) log("Found none of Claude Code, Claude Desktop, Codex or Gemini CLI. Install one, then run init again.");
  const cmd = wantedCommand(p, here);
  const shared = new Set<string>();
  for (const a of chosen) {
    try {
      for (const line of configure(a, d, cmd, shared)) log(line);
    } catch (err) {
      log(`${APP_NAMES[a]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  const missed = APPS.filter((a) => !chosen.includes(a));
  if (missed.length) log(`Not set up (not found): ${missed.map((a) => APP_NAMES[a]).join(", ")}. Add later with --apps.`);

  // 4. Google.
  let client = flag(argv, "oauth-client") ?? loadConfig(dir).oauthClientPath;
  if (!client) {
    log("\nThe harness signs in with a Google OAuth client you create (Desktop app type) in your own Google Cloud project, saved as a JSON file.");
    client = await ask("Path to the OAuth client JSON (Enter to skip for now): ", "", interactive);
  }
  if (client) {
    client = resolve(client.replace(/^~(?=$|[\\/])/, homedir()));
    readClientSecrets(client);
    if (client !== loadConfig(dir).oauthClientPath) {
      appendFileSync(join(dir, "config.local.md"), `\n- oauth client: ${client}\n`);
      log(`Saved the OAuth client path in ${join(dir, "config.local.md")} (not committed).`);
    }
    let token: string | null;
    try {
      token = keychainStore().get();
    } catch {
      token = null;
    }
    if (token && !has(argv, "login")) log("Already signed in to Google.");
    else if (has(argv, "no-login") || !interactive) log("Sign in later with `deal-harness login`.");
    else await login(client, keychainStore(), log);
  } else log("Skipped Google sign-in. Add `- oauth client: <path>` to config.local.md, then run `deal-harness login`.");

  log("\nDone. Restart the apps you use, then run `deal-harness doctor`. In the app, start with /company.");
}

async function serverStarts(cmd: ServerCommand): Promise<Check> {
  const client = new Client({ name: "doctor", version: "1" });
  const transport = new StdioClientTransport({ command: cmd.command, args: cmd.args, env: { ...(process.env as Record<string, string>), ...(cmd.env ?? {}) }, stderr: "ignore" });
  try {
    await Promise.race([client.connect(transport), new Promise((_, reject) => setTimeout(() => reject(new Error("timed out after 20s")), 20_000))]);
    const names = (await client.listTools()).tools.map((t) => t.name);
    const bad = names.filter((n) => /send|forward|share|label|delete|trash/i.test(n));
    if (bad.length) return { ok: false, text: `Server offers tools it never should: ${bad.join(", ")}.` };
    if (!names.includes("gmail_draft")) return { ok: false, text: "Server started but has no gmail_draft tool." };
    return { ok: true, text: `Server starts and offers ${names.length} tools, none that send.` };
  } catch (err) {
    return { ok: false, text: `Server doesn't start: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    await client.close().catch(() => {});
  }
}

export async function doctorChecks(): Promise<Check[]> {
  const p = place();
  const checks: Check[] = [];
  const [major] = process.versions.node.split(".").map(Number);
  checks.push((major ?? 0) >= 20 ? { ok: true, text: `Node ${process.versions.node}.` } : { ok: false, text: `Node ${process.versions.node}: 20 or newer is needed.` });

  const here = installedHere(p);
  const root = here ? PACKAGE_ROOT : installedRoot(harnessHome(p));
  const d = deps(root);
  checks.push(here ? { ok: true, warn: true, text: `No installed copy in ${harnessHome(p)}; checking this checkout instead (${PACKAGE_ROOT}).` } : { ok: true, text: `Harness ${d.version} installed in ${root}.` });
  const cmd = wantedCommand(p, here);

  const dir = dataDir(p.env);
  if (!existsSync(join(dir, "config.md"))) checks.push({ ok: false, text: `No data folder at ${dir} (run \`deal-harness init\`).` });
  else {
    checks.push({ ok: true, text: `Data folder ${dir}.` });
    if (!existsSync(join(dir, ".git"))) checks.push({ ok: true, warn: true, text: "The data folder isn't a git repo, so changes aren't versioned (install git, then run init again)." });
    const f = readFormat(dir);
    if (f < CURRENT_FORMAT) checks.push({ ok: false, text: `Data folder format ${f} is behind ${CURRENT_FORMAT} (run \`deal-harness update\`).` });
    const c = loadConfig(dir);
    if (!c.oauthClientPath) checks.push({ ok: false, text: "No Google OAuth client set (add `- oauth client: <path>` to config.local.md)." });
    else {
      try {
        readClientSecrets(c.oauthClientPath);
        checks.push({ ok: true, text: "Google OAuth client found." });
      } catch (err) {
        checks.push({ ok: false, text: err instanceof Error ? err.message : String(err) });
      }
    }
    try {
      checks.push(keychainStore().get() ? { ok: true, text: "Signed in to Google (token in the OS keychain)." } : { ok: false, text: "Not signed in to Google (run `deal-harness login`)." });
    } catch (err) {
      checks.push({ ok: false, text: `Can't reach the OS keychain: ${err instanceof Error ? err.message : String(err)}` });
    }
    checks.push(c.rateCardSheet ? { ok: true, text: "Rate card Sheet set." } : { ok: true, warn: true, text: "No rate card Sheet set: drafts with prices will be refused (`rate card sheet` in config.md)." });
    checks.push(c.dealsSheet ? { ok: true, text: "Deals Sheet set." } : { ok: true, warn: true, text: "No deals Sheet set: /rift and forecasts won't work yet (`deals sheet` in config.md)." });
  }

  checks.push(await serverStarts(cmd));
  const found = detect(d);
  const apps = APPS.filter((a) => found[a] || currentEntry(a, d) !== null);
  if (apps.length === 0) checks.push({ ok: false, text: "None of the apps is set up (run `deal-harness init`)." });
  for (const a of apps) checks.push(...checkApp(a, d, cmd));
  return checks;
}

export async function doctor(log: Log): Promise<void> {
  const checks = await doctorChecks();
  for (const c of checks) log(`${c.ok ? (c.warn ? "!" : "✓") : "✗"} ${c.text}`);
  const bad = checks.filter((c) => !c.ok).length;
  const warn = checks.filter((c) => c.warn).length;
  log(bad ? `\n${bad} problem(s) to fix.` : `\nAll good${warn ? ` (${warn} note(s))` : ""}.`);
  if (bad) process.exitCode = 1;
}

// Run as `npx deal-harness@latest update`: installs that version and refreshes every app that has the server.
export async function update(argv: string[], log: Log): Promise<void> {
  const p = place();
  const harness = harnessHome(p);
  const before = packageVersion(installedRoot(harness));
  const here = has(argv, "here");
  if (!here) installPackage(harness, PACKAGE_ROOT, log);
  const root = here ? PACKAGE_ROOT : installedRoot(harness);
  const d = deps(root);
  log(before && before !== d.version ? `Updated the harness from ${before} to ${d.version}.` : `Harness ${d.version}.`);
  const dir = dataDir(p.env);
  if (existsSync(join(dir, "config.md"))) {
    const m = await migrate(dir);
    if (m.changes.length) log(`Data folder updated to format ${m.to}:\n${m.changes.map((c) => `- ${c}`).join("\n")}`);
    else log(m.from < m.to ? `Data folder moved from format ${m.from} to ${m.to}; nothing in it needed changing.` : `Data folder already at format ${m.to}.`);
  }
  const cmd = wantedCommand(p, here);
  const shared = new Set<string>();
  for (const a of APPS.filter((x) => currentEntry(x, d) !== null)) {
    try {
      for (const line of configure(a, d, cmd, shared)) log(line);
    } catch (err) {
      log(`${APP_NAMES[a]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log("Restart the apps you use to load the new version.");
}

export async function uninstall(argv: string[], log: Log): Promise<void> {
  const p = place();
  const d = deps(installedHere(p) ? PACKAGE_ROOT : installedRoot(harnessHome(p)));
  const shared = new Set<string>();
  for (const a of APPS) {
    try {
      for (const line of unconfigure(a, d, shared)) log(line);
    } catch (err) {
      log(`${APP_NAMES[a]}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (process.platform === "darwin" || process.platform === "linux") await schedule(true, () => {}).catch(() => {});
  if (!has(argv, "keep-login")) {
    try {
      log(keychainStore().clear() ? "Removed the Google token from the keychain." : "No Google token was stored.");
    } catch {
      log("Couldn't reach the keychain to remove the Google token.");
    }
  }
  if (removePackage(harnessHome(p))) log(`Removed ${harnessHome(p)}.`);
  log(`Your data folder stays where it is: ${dataDir(p.env)}. Delete it yourself if you want it gone.`);
}
