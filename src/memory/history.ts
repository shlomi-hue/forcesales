// memory/history/<account>.md: a past deal rebuilt from email. The header lines are the deal's
// features, used for similar deals and the ICP map:
//   domains: acme.com · industry: logistics · size: 200-1000 · region: SEA
//   value: 48000 USD · competitor: Globex · first contact: 2025-03-02 · last contact: 2025-09-10

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSignals } from "./signals.js";

export interface PastDeal {
  account: string;
  name: string;
  industry?: string;
  size?: string;
  region?: string;
  value?: number;
  currency?: string;
  competitor?: string;
  firstContact?: string;
  lastContact?: string;
  worked: string[];
  wentWrong: string[];
}

const field = (md: string, key: string) => md.match(new RegExp(`^\\s*[-*]?\\s*${key}:\\s*(.+?)\\s*$`, "im"))?.[1];

export function parseHistory(account: string, md: string): PastDeal {
  const value = field(md, "value")?.match(/(\d[\d,.]*)\s*([A-Z]{3})?/);
  const signals = parseSignals(md).signals;
  const date = (k: string) => field(md, k)?.match(/\d{4}-\d{2}-\d{2}/)?.[0];
  const d: PastDeal = {
    account,
    name: md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? account,
    worked: signals.filter((s) => s.type === "worked").map((s) => `"${s.quote}" (${s.who})`),
    wentWrong: signals.filter((s) => s.type === "went-wrong").map((s) => `"${s.quote}" (${s.who})`),
  };
  const set = (k: keyof PastDeal, v: string | undefined) => {
    if (v && !/^(unknown|n\/a|-|\?)$/i.test(v)) (d as unknown as Record<string, unknown>)[k] = v;
  };
  set("industry", field(md, "industry"));
  set("size", field(md, "size"));
  set("region", field(md, "region"));
  set("competitor", field(md, "competitor"));
  set("firstContact", date("first contact"));
  set("lastContact", date("last contact"));
  if (value?.[1]) {
    d.value = Number(value[1].replace(/,/g, ""));
    if (value[2]) d.currency = value[2];
  }
  return d;
}

export function readHistory(dir: string): PastDeal[] {
  const h = join(dir, "memory", "history");
  if (!existsSync(h)) return [];
  const skip = new Set(["outcomes.md", "baseline.md", "scan.md"]);
  return readdirSync(h)
    .filter((f) => f.endsWith(".md") && !skip.has(f))
    .map((f) => parseHistory(f.replace(/\.md$/, ""), readFileSync(join(h, f), "utf8")));
}
