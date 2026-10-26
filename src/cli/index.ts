#!/usr/bin/env node
import { createRequire } from "node:module";
import { dataDir, ensureDataFolder } from "../data/folder.js";
import { loadConfig } from "../data/settings.js";
import { login } from "../google/auth.js";
import { keychainStore } from "../google/token-store.js";
import { reindex } from "../index/search.js";
import { confirmOutcomes } from "./confirm.js";
import { runJob, type Job } from "./run.js";
import { schedule } from "./schedule.js";
import { serve } from "./serve.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

const HELP = `deal-harness ${version}

  deal-harness serve    start the MCP server on stdio (used by Claude Code)
  deal-harness login    sign in to Google; the token goes in your OS keychain
  deal-harness logout   remove the token from the keychain
  deal-harness reindex  rebuild index.sqlite from the markdown in your data folder
  deal-harness run prep|nag        run one job now, headless (needs Claude Code's claude command)
  deal-harness schedule [--remove] run prep each evening and nag each morning (macOS, Linux)
  deal-harness confirm  go through past deal outcomes the harness inferred, and confirm or fix them

Settings live in config.md in your data folder. Environment variables override them:
  DEAL_HARNESS_DATA               data folder (default ~/deal-harness-data)
  DEAL_HARNESS_OAUTH_CLIENT       path to your Desktop OAuth client JSON
  DEAL_HARNESS_RATE_CARD_SHEET    rate card Sheet id or link
  DEAL_HARNESS_RATE_CARD_RANGE    optional A1 range; default reads every tab
  DEAL_HARNESS_RATE_CARD_COLUMNS  optional JSON naming columns, e.g. {"name":"Product","floor":"Walk-away"}
  DEAL_HARNESS_MAX_DISCOUNT       highest discount allowed, in percent
`;

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const log = (s: string) => console.error(s);
  switch (cmd) {
    case "serve":
      return serve(version);
    case "login":
      return login(loadConfig(dataDir()).oauthClientPath, keychainStore(), log);
    case "logout":
      log(keychainStore().clear() ? "Signed out." : "No token was stored.");
      return;
    case "reindex": {
      const dir = dataDir();
      await ensureDataFolder(dir);
      const { files, chunks } = reindex(dir);
      log(`Rebuilt ${dir}/index.sqlite: ${files} files, ${chunks} sections.`);
      return;
    }
    case "run": {
      const job = process.argv[3];
      if (job !== "prep" && job !== "nag") throw new Error("Usage: deal-harness run prep|nag");
      return runJob(job as Job, log);
    }
    case "confirm":
      return confirmOutcomes(log);
    case "schedule":
      return schedule(process.argv.includes("--remove"), log);
    case undefined:
    case "help":
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return;
    case "--version":
    case "-v":
      process.stdout.write(`${version}\n`);
      return;
    default:
      console.error(`Unknown command: ${cmd}\n\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
