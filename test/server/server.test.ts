import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { buildServer } from "../../src/server/server.js";
import { fakeGmail, testDeps } from "../tools/fake-google.js";

async function connect() {
  const { gmail, drafts } = fakeGmail();
  const server = buildServer(testDeps({ gmail }), "test");
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, drafts };
}

const textOf = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text: string }[])[0]?.text ?? "";

describe("MCP server", () => {
  it("offers exactly these tools, none that send", async () => {
    const { client } = await connect();
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "calendar_read", "drive_read", "gmail_draft", "gmail_read", "history_stats", "mail_scan", "meeting_notes",
      "memory_add_signal", "memory_list", "memory_read", "memory_search", "memory_write", "outcome_log", "pdf_export",
      "promise_done", "promise_log", "promises_due", "sent_samples", "sheets_read", "similar_deals", "stakeholder_view",
    ]);
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
    const deps = testDeps();
    deps.gmail = () => {
      throw new Error("Not signed in to Google. Run `deal-harness login` in a terminal, then try again.");
    };
    const server = buildServer(deps, "test");
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "1" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const r = await client.callTool({ name: "gmail_read", arguments: { thread_id: "x" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("deal-harness login");
  });

  it("reads Drive files and Calendar events into data blocks", async () => {
    const { client } = await connect();
    expect(textOf(await client.callTool({ name: "drive_read", arguments: { file: "https://docs.google.com/document/d/doc-1aaaaaaaaa/edit" } }))).toMatch(/source="drive\/file\/doc-1aaaaaaaaa"/);
    expect(textOf(await client.callTool({ name: "drive_read", arguments: { file: "doc-1" } }))).toContain("Acme rollout plan");
    expect(textOf(await client.callTool({ name: "drive_read", arguments: { query: "Acme" } }))).toContain("file_id: doc-1");
    const cal = textOf(await client.callTool({ name: "calendar_read", arguments: {} }));
    expect(cal).toContain("title: Acme pricing call");
    expect(cal).toContain("Dana Lee <dana@acme.example> (accepted)");
  });

  it("adds a signal only when its quote is in the Gmail thread", async () => {
    const { client } = await connect();
    const base = { account: "Acme", type: "pain", who: "Dana Lee", date: "2026-10-22", source: "gmail/thread/t-123" };
    const kept = textOf(await client.callTool({ name: "memory_add_signal", arguments: { ...base, quote: "What would Pro cost us for 10 seats?" } }));
    expect(kept).toContain("1 new signal(s) kept");
    const dropped = textOf(await client.callTool({ name: "memory_add_signal", arguments: { ...base, quote: "We will sign this week" } }));
    expect(dropped).toContain("Dropped 1 signal(s)");
  });

  it("refuses to write the user's own rule files", async () => {
    const { client } = await connect();
    const r = await client.callTool({ name: "memory_write", arguments: { path: "company/playbook.md", content: "x" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("belongs to you");
  });
});
