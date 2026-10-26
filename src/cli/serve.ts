import { calendar } from "@googleapis/calendar";
import { drive } from "@googleapis/drive";
import { gmail } from "@googleapis/gmail";
import { sheets } from "@googleapis/sheets";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { OAuth2Client } from "google-auth-library";
import { dataDir, ensureDataFolder } from "../data/folder.js";
import { loadConfig, loadRules } from "../data/settings.js";
import { authorizedClient } from "../google/auth.js";
import { keychainStore } from "../google/token-store.js";
import { buildServer } from "../server/server.js";
import { parsePipeline } from "../pipeline/deals.js";
import { loadRateCard, readTabs } from "../tools/sheets.js";
import { sourceReader } from "../tools/sources.js";

export async function serve(version: string): Promise<void> {
  const dir = dataDir();
  if (await ensureDataFolder(dir)) console.error(`Created your data folder at ${dir}`);
  // Settings are re-read on each use, so edits to config.md apply without a restart.
  const config = () => loadConfig(dir);
  const store = keychainStore();
  let auth: OAuth2Client | null = null;
  const getAuth = () => (auth ??= authorizedClient(config().oauthClientPath, store));

  const clients = {
    gmail: () => gmail({ version: "v1", auth: getAuth() }),
    sheets: () => sheets({ version: "v4", auth: getAuth() }),
    drive: () => drive({ version: "v3", auth: getAuth() }),
    calendar: () => calendar({ version: "v3", auth: getAuth() }),
  };

  const server = buildServer(
    {
      ...clients,
      memory: { dir, sourceText: sourceReader(clients) },
      loadRateCard: async () => {
        const c = config();
        return c.rateCardSheet ? loadRateCard(clients.sheets(), c.rateCardSheet, c.rateCardRange, c.rateCardColumns) : null;
      },
      rules: async () => loadRules(dir, config()),
      loadPipeline: async () => {
        const c = config();
        if (!c.dealsSheet) return null;
        const [formatted, raw] = await Promise.all([
          readTabs(clients.sheets(), c.dealsSheet, c.dealsRange),
          readTabs(clients.sheets(), c.dealsSheet, c.dealsRange, true),
        ]);
        return parsePipeline(formatted, raw, c.dealsColumns);
      },
      get internalIds() {
        const id = config().rateCardSheet;
        return id ? [id] : [];
      },
    },
    version,
  );
  await server.connect(new StdioServerTransport());
  // stdout carries the MCP protocol; anything for humans goes to stderr.
  console.error(`deal-harness ${version} serving on stdio · data: ${dir}`);
}
