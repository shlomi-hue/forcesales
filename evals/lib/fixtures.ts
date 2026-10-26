// Recorded threads as Gmail returns them, and a harness server over fakes for evals.
// The data folder is always a temp copy of templates/data, never the user's.

import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { gmail_v1 } from "@googleapis/gmail";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { DEFAULT_BANNED } from "../../src/checks/words.js";
import { buildServer, type ServerDeps } from "../../src/server/server.js";
import type { Calendar } from "../../src/tools/calendar.js";
import type { Drive } from "../../src/tools/drive.js";
import { fakeGmail, testDeps } from "../../test/tools/fake-google.js";

export interface FixtureMessage {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date?: string;
  text?: string;
  html?: string;
  reply_to?: string;
}

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

export function toThread(id: string, messages: FixtureMessage[]): gmail_v1.Schema$Thread {
  return {
    id,
    messages: messages.map((m, i) => ({
      id: `${id}-m${i}`,
      threadId: id,
      snippet: (m.text ?? "").slice(0, 80),
      labelIds: /seller\.example/.test(m.from) ? ["SENT"] : ["INBOX"],
      internalDate: String(Date.parse(m.date ?? `2026-10-22T0${i}:00:00+08:00`)),
      payload: {
        mimeType: "multipart/alternative",
        headers: [
          { name: "From", value: m.from },
          { name: "To", value: m.to },
          ...(m.cc ? [{ name: "Cc", value: m.cc }] : []),
          { name: "Subject", value: m.subject },
          { name: "Date", value: m.date ?? `Thu, 22 Oct 2026 0${i}:00:00 +0800` },
          { name: "Message-ID", value: `<${id}-m${i}@fixture.example>` },
          ...(m.reply_to ? [{ name: "Reply-To", value: m.reply_to }] : []),
        ],
        parts: [
          ...(m.text ? [{ mimeType: "text/plain", body: { data: b64(m.text) } }] : []),
          ...(m.html ? [{ mimeType: "text/html", body: { data: b64(m.html) } }] : []),
        ],
      },
    })),
  };
}

// No meetings and no files: an agent run sees only the thread.
const emptyCalendar = { events: { list: async () => ({ data: { items: [] } }), get: async () => Promise.reject(new Error("Not found")) } } as unknown as Calendar;
const emptyDrive = { files: { list: async () => ({ data: { files: [] } }), get: async () => Promise.reject(new Error("Not found")) } } as unknown as Drive;

export function fixtureDeps(thread: gmail_v1.Schema$Thread, opts: { accounts?: { name: string; domains: string[] }[]; sentTo?: string[] } = {}) {
  const { gmail, drafts } = fakeGmail({ thread, sentTo: opts.sentTo ?? [] });
  const deps: ServerDeps = {
    ...testDeps({ gmail }),
    calendar: () => emptyCalendar,
    drive: () => emptyDrive,
    rules: async () => ({ maxDiscountPercent: 15, banned: DEFAULT_BANNED, accounts: opts.accounts ?? [] }),
  };
  return { deps, drafts };
}

export async function inMemoryClient(deps: ServerDeps): Promise<Client> {
  const server = buildServer(deps, "eval");
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "eval", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

export const textOf = (r: Awaited<ReturnType<Client["callTool"]>>) => (r.content as { text: string }[])[0]?.text ?? "";

// The harness on a local HTTP port, for a real Claude Code run (`claude -p`) to call.
export async function httpServer(deps: ServerDeps): Promise<{ url: string; close: () => Promise<void> }> {
  const server = buildServer(deps, "eval");
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);
  const http: Server = createServer((req, res) => {
    transport.handleRequest(req, res).catch((err: unknown) => {
      res.statusCode = 500;
      res.end(String(err));
    });
  });
  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const { port } = http.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await server.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
