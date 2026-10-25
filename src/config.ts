// Phase 1 settings come from environment variables (set in .mcp.json).
// They move to config.md in the data folder in Phase 3.

import type { ColumnOverrides } from "./checks/rate-card.js";

export interface Config {
  oauthClientPath: string | undefined;
  rateCardSheet: string | undefined;
  rateCardRange: string | undefined;
  rateCardColumns: ColumnOverrides | undefined;
  maxDiscountPercent: number | undefined;
  // Replaces the default banned list when set.
  bannedWords: string[] | undefined;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    oauthClientPath: env.DEAL_HARNESS_OAUTH_CLIENT || undefined,
    rateCardSheet: env.DEAL_HARNESS_RATE_CARD_SHEET ? sheetId(env.DEAL_HARNESS_RATE_CARD_SHEET) : undefined,
    rateCardRange: env.DEAL_HARNESS_RATE_CARD_RANGE || undefined,
    rateCardColumns: env.DEAL_HARNESS_RATE_CARD_COLUMNS ? parseColumns(env.DEAL_HARNESS_RATE_CARD_COLUMNS) : undefined,
    maxDiscountPercent: env.DEAL_HARNESS_MAX_DISCOUNT ? percent(env.DEAL_HARNESS_MAX_DISCOUNT) : undefined,
    bannedWords: env.DEAL_HARNESS_BANNED_WORDS
      ? env.DEAL_HARNESS_BANNED_WORDS.split(",").map((w) => w.trim()).filter(Boolean)
      : undefined,
  };
}

// Accept a bare id or a full docs.google.com link.
export function sheetId(value: string): string {
  return value.match(/\/spreadsheets\/d\/([\w-]+)/)?.[1] ?? value.trim();
}

function parseColumns(json: string): ColumnOverrides {
  try {
    return JSON.parse(json) as ColumnOverrides;
  } catch {
    throw new Error("DEAL_HARNESS_RATE_CARD_COLUMNS is not valid JSON. Example: {\"name\":\"Product\",\"floor\":\"Walk-away\"}");
  }
}

function percent(value: string): number {
  const n = Number(value.replace("%", "").trim());
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error(`DEAL_HARNESS_MAX_DISCOUNT must be a percent from 0 to 100, got "${value}".`);
  return n;
}
