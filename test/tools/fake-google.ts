import { readFileSync } from "node:fs";
import type { gmail_v1 } from "@googleapis/gmail";
import type { Gmail } from "../../src/tools/gmail.js";

// A recorded-thread stand-in for the Gmail client. Records every draft it's asked to create.
export function fakeGmail(threadFile = "test/fixtures/gmail-thread.json") {
  const thread = JSON.parse(readFileSync(threadFile, "utf8")) as gmail_v1.Schema$Thread;
  const drafts: gmail_v1.Schema$Draft[] = [];
  const gmail = {
    users: {
      getProfile: async () => ({ data: { emailAddress: "me@seller.example" } }),
      threads: {
        get: async ({ id }: { id: string }) => {
          if (id !== thread.id) throw new Error(`Requested entity was not found: ${id}`);
          return { data: thread };
        },
        list: async () => ({ data: { threads: [{ id: thread.id }] } }),
      },
      drafts: {
        create: async ({ requestBody }: { requestBody: gmail_v1.Schema$Draft }) => {
          drafts.push(requestBody);
          return { data: { id: `d-${drafts.length}`, message: { id: "dm-1", threadId: requestBody.message?.threadId } } };
        },
      },
    },
  } as unknown as Gmail;
  return { gmail, drafts };
}

export function decodeRaw(raw: string): { headers: string; body: string } {
  const text = Buffer.from(raw, "base64url").toString("utf8");
  const [headers = "", b64 = ""] = text.split("\r\n\r\n");
  return { headers, body: Buffer.from(b64.replace(/\r\n/g, ""), "base64").toString("utf8") };
}
