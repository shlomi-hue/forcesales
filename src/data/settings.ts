// Settings from config.md and config.local.md ("- key: value" lines), with environment variables on top.
// Also reads the check rules that live in the data folder: never-say words and known accounts.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CheckRules } from "../checks/draft.js";
import type { OtherAccount } from "../checks/leak.js";
import { DEFAULT_BANNED } from "../checks/words.js";
import { readConfig, type Config } from "../config.js";

export function parseSettings(markdown: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const m = line.match(/^\s*[-*]\s+([^:]+?):\s*(.*?)\s*$/);
    if (m?.[1] && m[2]) out[m[1].toLowerCase()] = m[2].replace(/^`(.*)`$/, "$1");
  }
  return out;
}

const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");

// Same shape as readConfig(), filled from the data folder files under the environment.
export function loadConfig(dir: string, env: NodeJS.ProcessEnv = process.env): Config {
  const file = { ...parseSettings(read(join(dir, "config.md"))), ...parseSettings(read(join(dir, "config.local.md"))) };
  const fromFile: NodeJS.ProcessEnv = {
    DEAL_HARNESS_OAUTH_CLIENT: file["oauth client"],
    DEAL_HARNESS_RATE_CARD_SHEET: file["rate card sheet"],
    DEAL_HARNESS_RATE_CARD_RANGE: file["rate card range"],
    DEAL_HARNESS_RATE_CARD_COLUMNS: file["rate card columns"],
    DEAL_HARNESS_MAX_DISCOUNT: file["max discount"],
    DEAL_HARNESS_DEALS_SHEET: file["deals sheet"],
    DEAL_HARNESS_DEALS_RANGE: file["deals range"],
    DEAL_HARNESS_DEALS_COLUMNS: file["deals columns"],
    DEAL_HARNESS_BANNED_WORDS: undefined,
  };
  const merged: NodeJS.ProcessEnv = { ...fromFile };
  for (const [k, v] of Object.entries(env)) if (k.startsWith("DEAL_HARNESS_") && v) merged[k] = v;
  return readConfig(merged);
}

// Bullets under "## Never say" in company/voice.md.
export function neverSay(voiceMd: string): string[] {
  const section = voiceMd.replace(/<!--[\s\S]*?-->/g, "").split(/^##\s+/m).find((s) => /^never say\b/i.test(s));
  if (!section) return [];
  return section
    .split("\n")
    .slice(1)
    .map((l) => l.match(/^\s*[-*]\s+["“]?(.+?)["”]?\s*$/)?.[1] ?? "")
    .filter(Boolean);
}

// Each account and past-deal file: "# Name" title and a "domains: a.com, b.com" line.
export function knownAccounts(dir: string): OtherAccount[] {
  const skip = new Set(["outcomes.md", "baseline.md", "scan.md"]);
  const seen = new Map<string, OtherAccount>();
  for (const sub of ["accounts", "history"]) {
    const folder = join(dir, "memory", sub);
    if (!existsSync(folder)) continue;
    for (const f of readdirSync(folder).filter((x) => x.endsWith(".md") && !skip.has(x))) {
      const md = readFileSync(join(folder, f), "utf8");
      const name = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? f.replace(/\.md$/, "");
      const domains = (md.match(/^\s*[-*]?\s*domains?:\s*(.+)$/im)?.[1] ?? "")
        .split(/[,\s]+/)
        .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
        .filter((d) => d.includes("."));
      const prev = seen.get(name.toLowerCase());
      seen.set(name.toLowerCase(), { name, domains: [...new Set([...(prev?.domains ?? []), ...domains])] });
    }
  }
  return [...seen.values()];
}

export function loadRules(dir: string, config: Config): CheckRules {
  const banned = config.bannedWords ?? [...DEFAULT_BANNED, ...neverSay(read(join(dir, "company", "voice.md")))];
  return { maxDiscountPercent: config.maxDiscountPercent, banned, accounts: knownAccounts(dir) };
}
