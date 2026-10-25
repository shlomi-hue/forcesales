import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { parseRateCard } from "../../src/checks/rate-card.js";
import { buildServer } from "../../src/server/server.js";
import type { Sheets } from "../../src/tools/sheets.js";
import { simple } from "../checks/fixtures.js";
import { fakeGmail, rules } from "../tools/fake-google.js";

const fakeSheets = {
  spreadsheets: {
    get: async () => ({ data: { sheets: [{ properties: { title: "Rate card" } }] } }),
    values: { batchGet: async () => ({ data: { valueRanges: [{ range: "'Rate card'!A1:E4", values: simple[0]?.rows }] } }) },
  },
} as unknown as Sheets;

async function connect() {
  const { gmail, drafts } = fakeGmail();
  const server = buildServer(
    { gmail: () => gmail, sheets: () => fakeSheets, loadRateCard: async () => parseRateCard(simple), rules: async () => rules, internalIds: [] },
    "test",
  );
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, drafts };
}

const textOf = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text: string }[])[0]?.text ?? "";

describe("MCP server", () => {
  it("offers exactly the Phase 1 tools, none that send", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["gmail_draft", "gmail_read", "sheets_read"]);
  });

  it("returns a refusal as a tool error, with reasons", async () => {
    const { client, drafts } = await connect();
    const r = await client.callTool({ name: "gmail_draft", arguments: { thread_id: "t-123", body: "Pro at $40", prices: [{ item: "Pro", unit_price: 40 }] } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/^REFUSED: no draft was created\.\n- \[pricing\] "Pro" at 40 is below the rate card floor of 50 USD/);
    expect(drafts).toHaveLength(0);
  });

  it("creates a checked draft", async () => {
    const { client, drafts } = await connect();
    const r = await client.callTool({ name: "gmail_draft", arguments: { thread_id: "t-123", body: "Pro at $55", prices: [{ item: "Pro", unit_price: 55 }] } });
    expect(r.isError).toBeFalsy();
    expect(textOf(r)).toContain("Draft created (not sent)");
    expect(drafts).toHaveLength(1);
  });

  it("rejects header injection in addresses", async () => {
    const { client, drafts } = await connect();
    const r = await client.callTool({ name: "gmail_draft", arguments: { to: ["a@b.example\r\nBcc: x@y.example"], subject: "Hi", body: "Hello" } });
    expect(r.isError).toBe(true);
    expect(drafts).toHaveLength(0);
  });

  it("reads a sheet into a data block", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "sheets_read", arguments: { spreadsheet: "https://docs.google.com/spreadsheets/d/abc123/edit" } });
    expect(textOf(r)).toMatch(/^<<<OUTSIDE_DATA id=\w+ source="sheets\/abc123">>>\n## Rate card\n1\tSKU\tProduct/);
  });

  it("says how to sign in when there's no token", async () => {
    const server = buildServer(
      {
        gmail: () => {
          throw new Error("Not signed in to Google. Run `deal-harness login` in a terminal, then try again.");
        },
        sheets: () => fakeSheets,
        loadRateCard: async () => null,
        rules: async () => rules,
        internalIds: [],
      },
      "test",
    );
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: "gmail_read", arguments: { thread_id: "x" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("deal-harness login");
  });
});
