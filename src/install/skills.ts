// Copy the shipped skills into an app's skills folder, and take them out again.
// Each copied skill gets a .deal-harness marker, so the harness only ever replaces or removes
// skill folders it put there itself. A folder of the same name without the marker is left alone.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { zip } from "./zip.js";

export const MARKER = ".deal-harness";

export const skillNames = (source: string) =>
  readdirSync(source).filter((d) => !d.startsWith(".") && existsSync(join(source, d, "SKILL.md"))).sort();

const ours = (dir: string) => existsSync(join(dir, MARKER));

export interface SkillCopy {
  installed: string[];
  skipped: string[];
}

export function installSkills(source: string, dest: string, version: string): SkillCopy {
  mkdirSync(dest, { recursive: true });
  const r: SkillCopy = { installed: [], skipped: [] };
  for (const name of skillNames(source)) {
    const target = join(dest, name);
    if (existsSync(target) && !ours(target)) {
      r.skipped.push(name);
      continue;
    }
    rmSync(target, { recursive: true, force: true });
    cpSync(join(source, name), target, { recursive: true, dereference: true });
    writeFileSync(join(target, MARKER), `${version}\n`);
    r.installed.push(name);
  }
  return r;
}

export function removeSkills(source: string, dest: string): string[] {
  const removed: string[] = [];
  for (const name of skillNames(source)) {
    const target = join(dest, name);
    if (existsSync(target) && ours(target)) {
      rmSync(target, { recursive: true, force: true });
      removed.push(name);
    }
  }
  return removed;
}

// Skills that are missing or differ from the shipped ones (or that someone else's folder holds).
export function staleSkills(source: string, dest: string): { missing: string[]; outdated: string[]; notOurs: string[] } {
  const r = { missing: [] as string[], outdated: [] as string[], notOurs: [] as string[] };
  for (const name of skillNames(source)) {
    const target = join(dest, name);
    if (!existsSync(join(target, "SKILL.md"))) r.missing.push(name);
    else if (!ours(target)) r.notOurs.push(name);
    else if (readFileSync(join(target, "SKILL.md"), "utf8") !== readFileSync(join(source, name, "SKILL.md"), "utf8")) r.outdated.push(name);
  }
  return r;
}

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

// One zip per skill, with the skill folder at the top, for uploading to Claude Desktop.
export function zipSkills(source: string, dest: string): string[] {
  mkdirSync(dest, { recursive: true });
  return skillNames(source).map((name) => {
    const files = walk(join(source, name)).map((p) => ({ name: `${name}/${relative(join(source, name), p)}`, data: readFileSync(p) }));
    const out = join(dest, `${name}.zip`);
    writeFileSync(out, zip(files));
    return out;
  });
}
