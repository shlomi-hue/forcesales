import { gmail } from "@googleapis/gmail";
import { sheets } from "@googleapis/sheets";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OAuth2Client } from "google-auth-library";
import { readConfig } from "../config.js";
import { authorizedClient } from "../google/auth.js";
import { keychainStore } from "../google/token-store.js";
import { buildServer } from "../server/server.js";
import { loadRateCard } from "../tools/sheets.js";

export async function serve(version: string): Promise<void> {
  const config = readConfig();
  const store = keychainStore();
  let auth: OAuth2Client | null = null;
  const getAuth = () => (auth ??= authorizedClient(config.oauthClientPath, store));
  const getSheets = () => sheets({ version: "v4", auth: getAuth() });

  const server = buildServer(
    {
      gmail: () => gmail({ version: "v1", auth: getAuth() }),
      sheets: getSheets,
      loadRateCard: async () =>
        config.rateCardSheet
          ? loadRateCard(getSheets(), config.rateCardSheet, config.rateCardRange, config.rateCardColumns)
          : null,
    },
    version,
  );
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol; anything for humans goes to stderr.
  console.error(`deal-harness ${version} serving on stdio`);
}
