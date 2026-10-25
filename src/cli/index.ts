#!/usr/bin/env node
import { createRequire } from "node:module";
import { readConfig } from "../config.js";
import { login } from "../google/auth.js";
import { keychainStore } from "../google/token-store.js";
import { serve } from "./serve.js";

const { version } = createRequire(import.meta.url)("../../package.json") as { version: string };

const HELP = `deal-harness ${version}

  deal-harness serve    start the MCP server on stdio (used by Claude Code)
  deal-harness login    sign in to Google; the token goes in your OS keychain
  deal-harness logout   remove the token from the keychain

Settings (environment variables):
  DEAL_HARNESS_OAUTH_CLIENT       path to your Desktop OAuth client JSON
  DEAL_HARNESS_RATE_CARD_SHEET    rate card Sheet id or link
  DEAL_HARNESS_RATE_CARD_RANGE    optional A1 range; default reads every tab
  DEAL_HARNESS_RATE_CARD_COLUMNS  optional JSON naming columns, e.g. {"name":"Product","floor":"Walk-away"}
`;

async function main(): Promise<void> {
  const cmd = process.argv[2];
  const log = (s: string) => console.error(s);
  switch (cmd) {
    case "serve":
      return serve(version);
    case "login":
      return login(readConfig().oauthClientPath, keychainStore(), log);
    case "logout":
      log(keychainStore().clear() ? "Signed out." : "No token was stored.");
      return;
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
