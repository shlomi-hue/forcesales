// The harness's own copy: <harness home>/app. Every app's MCP entry points at it, so it keeps
// working after npx clears its cache, and GUI apps don't need npx on their PATH.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerCommand } from "./apps.js";

// Works from src/install (tests) and dist/install (the package).
export const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));

export const appDir = (harness: string) => join(harness, "app");
export const installedRoot = (harness: string) => join(appDir(harness), "node_modules", "deal-harness");
export const installedCli = (harness: string) => join(installedRoot(harness), "dist", "cli", "index.js");

export const packageVersion = (root: string): string | null => {
  try {
    return (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version?: string }).version ?? null;
  } catch {
    return null;
  }
};

// How every app starts the server: this node, by absolute path, running the installed copy.
export const serverCommand = (harness: string, node = process.execPath): ServerCommand => ({ command: node, args: [installedCli(harness), "serve"] });

const npm = process.platform === "win32" ? "npm.cmd" : "npm";

// Pack the running package and install it, with its dependencies, into the harness's app folder.
export function installPackage(harness: string, from = PACKAGE_ROOT, log: (s: string) => void = () => {}): string {
  if (resolve(from) === resolve(installedRoot(harness))) return installedRoot(harness);
  if (!existsSync(join(from, "dist", "cli", "index.js"))) throw new Error(`No build in ${from}. Run npm run build first.`);
  const tmp = mkdtempSync(join(tmpdir(), "dh-pack-"));
  try {
    log("Packing the harness...");
    execFileSync(npm, ["pack", from, "--pack-destination", tmp, "--silent"], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    const tgz = readdirSync(tmp).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error("npm pack made no package.");
    const app = appDir(harness);
    mkdirSync(app, { recursive: true });
    if (!existsSync(join(app, "package.json"))) writeFileSync(join(app, "package.json"), `${JSON.stringify({ name: "deal-harness-app", private: true }, null, 2)}\n`);
    log(`Installing into ${app} (a minute the first time)...`);
    execFileSync(npm, ["install", "--omit=dev", "--no-audit", "--no-fund", "--prefix", app, join(tmp, tgz)], { stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    return installedRoot(harness);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function removePackage(harness: string): boolean {
  const app = appDir(harness);
  if (!existsSync(app)) return false;
  rmSync(app, { recursive: true, force: true });
  if (existsSync(harness) && readdirSync(harness).length === 0) rmSync(harness, { recursive: true, force: true });
  return true;
}

