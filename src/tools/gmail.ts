import type { gmail_v1 } from "@googleapis/gmail";
import { findAmounts } from "../checks/money.js";
import { addressesIn, companyDomain } from "../checks/addresses.js";
import { findDiscounts, type DeclaredDiscount } from "../checks/discount.js";
import { draftChecks, type CheckRules } from "../checks/draft.js";
import type { DeclaredPrice } from "../checks/pricing.js";
import type { RateCard } from "../checks/rate-card.js";
import { dataBlock } from "../server/data-block.js";

export type Gmail = Pick<gmail_v1.Gmail, "users">;
type Message = gmail_v1.Schema$Message;
type Part = gmail_v1.Schema$MessagePart;

const MAX_BODY_CHARS = 20_000;

// ---------- reading ----------

// Subjects and bodies only, no block: what quote.check compares signal quotes against.
export async function threadText(gmail: Gmail, threadId: string): Promise<string> {
  const { data } = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  return (data.messages ?? []).map((m) => `${header(m, "Subject")}\n${bodyText(m.payload)}`).join("\n\n");
}

export async function readThread(gmail: Gmail, threadId: string): Promise<string> {
  const { data } = await gmail.users.threads.get({ userId: "me", id: threadId, format: "full" });
  const messages = (data.messages ?? []).map(formatMessage).join("\n\n---\n\n");
  return dataBlock(`gmail/thread/${threadId}`, `thread_id: ${threadId}\n\n${messages}`);
}

export async function searchThreads(gmail: Gmail, query: string, max: number): Promise<string> {
  const list = await gmail.users.threads.list({ userId: "me", q: query, maxResults: max });
  const threads = list.data.threads ?? [];
  if (threads.length === 0) return `No threads match: ${query}`;
  const rows = await Promise.all(
    threads.map(async (t) => {
      const { data } = await gmail.users.threads.get({
        userId: "me",
        id: t.id ?? "",
        format: "metadata",
        metadataHeaders: ["From", "To", "Subject", "Date"],
      });
      const last = data.messages?.at(-1);
      const h = (n: string) => header(last, n);
      return `thread_id: ${t.id}\nsubject: ${h("Subject")}\nlast from: ${h("From")}\nlast date: ${h("Date")}\nmessages: ${data.messages?.length ?? 0}\nsnippet: ${decodeEntities(last?.snippet ?? "")}`;
    }),
  );
  return dataBlock(`gmail/search`, rows.join("\n\n"));
}

function formatMessage(m: Message): string {
  const h = (n: string) => header(m, n);
  const lines = [`from: ${h("From")}`, `to: ${h("To")}`];
  if (h("Cc")) lines.push(`cc: ${h("Cc")}`);
  lines.push(`date: ${h("Date")}`, `subject: ${h("Subject")}`, `message_id: ${m.id}`, "");
  let body = bodyText(m.payload);
  if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}\n[... cut at ${MAX_BODY_CHARS} characters]`;
  lines.push(body);
  return lines.join("\n");
}

export function header(m: Message | undefined, name: string): string {
  const lower = name.toLowerCase();
  return m?.payload?.headers?.find((h) => h.name?.toLowerCase() === lower)?.value ?? "";
}

// Plain text when the message has it, otherwise the HTML with tags stripped. Attachments are skipped.
export function bodyText(part: Part | undefined): string {
  if (!part) return "";
  const plain = findPart(part, "text/plain");
  if (plain) return decode(plain).trim();
  const html = findPart(part, "text/html");
  return html ? htmlToText(decode(html)) : "";
}

function findPart(part: Part, mime: string): Part | undefined {
  if (part.filename) return undefined;
  if (part.mimeType === mime && part.body?.data) return part;
  for (const p of part.parts ?? []) {
    const found = findPart(p, mime);
    if (found) return found;
  }
  return undefined;
}

const decode = (p: Part) => Buffer.from(p.body?.data ?? "", "base64url").toString("utf8");

function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim();
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&");
}

// ---------- drafting ----------

export interface DraftInput {
  thread_id?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body: string;
  prices: DeclaredPrice[];
  discounts: DeclaredDiscount[];
}

export type DraftResult =
  | { created: true; draftId: string; messageId: string; threadId: string | null; to: string[] }
  | { created: false; reasons: string[] };

export interface DraftDeps {
  gmail: Gmail;
  // Loaded only when the draft has prices or discounts. null means no rate card is configured.
  loadRateCard: () => Promise<RateCard | null>;
  rules: () => Promise<CheckRules>;
  // Sheet and file ids that must never appear in a draft (the rate card, at least).
  internalIds: string[];
}

// Runs every check before anything is written to Gmail. A failed check means no draft.
export async function createDraft(deps: DraftDeps, input: DraftInput): Promise<DraftResult> {
  const { gmail } = deps;
  const ownEmail = (await gmail.users.getProfile({ userId: "me" })).data.emailAddress?.toLowerCase() ?? "";
  let to = input.to ?? [];
  let subject = input.subject ?? "";
  let participants: string[] | null = null;
  const threading: string[] = [];

  if (input.thread_id) {
    const { data } = await gmail.users.threads.get({
      userId: "me",
      id: input.thread_id,
      format: "metadata",
      metadataHeaders: ["From", "To", "Cc", "Reply-To", "Subject", "Message-ID", "References"],
    });
    const messages = data.messages ?? [];
    const last = messages.at(-1);
    if (!last) return { created: false, reasons: [`Thread ${input.thread_id} has no messages.`] };
    // Reply-To is left out on purpose: a stranger's Reply-To doesn't make them part of the thread.
    participants = [...new Set(messages.flatMap((m) => ["From", "To", "Cc"].flatMap((h) => addressesIn(header(m, h)))))];
    if (to.length === 0) {
      const lastFrom = addressesIn(header(last, "From"))[0] ?? "";
      to = splitAddressList(lastFrom === ownEmail ? header(last, "To") : header(last, "Reply-To") || header(last, "From"));
    }
    if (!subject) {
      const s = header(last, "Subject");
      subject = /^re:/i.test(s) ? s : `Re: ${s}`;
    }
    const msgId = header(last, "Message-ID");
    if (msgId) threading.push(`In-Reply-To: ${msgId}`, `References: ${[header(last, "References"), msgId].filter(Boolean).join(" ")}`);
  }
  if (to.length === 0) return { created: false, reasons: ["No recipient. Give `to`, or a thread_id to reply on."] };

  const cc = input.cc ?? [];
  const bcc = input.bcc ?? [];
  const text = `${subject}\n${input.body}`;
  const needsCard = input.prices.length > 0 || input.discounts.length > 0 || findAmounts(text).length > 0 || findDiscounts(text).length > 0;
  const [card, rules, knownAddresses] = await Promise.all([
    needsCard ? deps.loadRateCard() : Promise.resolve(null),
    deps.rules(),
    participants ? Promise.resolve([]) : sentBefore(gmail, [...to, ...cc]),
  ]);

  const checks = draftChecks({
    to, cc, bcc, subject, body: input.body, prices: input.prices, discounts: input.discounts,
    card, rules, ownEmail, threadParticipants: participants, knownAddresses, internalIds: deps.internalIds,
  });
  if (!checks.ok) return { created: false, reasons: checks.reasons };

  const raw = buildMime({ to, cc, bcc, subject, body: input.body, extra: threading });
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw, ...(input.thread_id ? { threadId: input.thread_id } : {}) } },
  });
  return {
    created: true,
    draftId: res.data.id ?? "",
    messageId: res.data.message?.id ?? "",
    threadId: res.data.message?.threadId ?? null,
    to,
  };
}

// Split a header like `"Lee, Dana" <dana@acme.com>, bob@x.com` on commas outside quotes, keeping names.
function splitAddressList(value: string): string[] {
  return value
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));
}

// Which of these addresses (or their company domains) the user has sent mail to before.
async function sentBefore(gmail: Gmail, recipients: string[]): Promise<string[]> {
  const known: string[] = [];
  for (const address of recipients.flatMap(addressesIn)) {
    const hit = async (who: string) =>
      ((await gmail.users.threads.list({ userId: "me", q: `in:sent (to:${who} OR cc:${who})`, maxResults: 1 })).data.threads ?? []).length > 0;
    if (await hit(address)) {
      known.push(address);
      continue;
    }
    const domain = companyDomain(address);
    if (domain && (await hit(domain))) known.push(`@${domain}`);
  }
  return known;
}

const noBreaks = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function encodeHeader(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

export function buildMime(m: { to: string[]; cc: string[]; bcc: string[]; subject: string; body: string; extra: string[] }): string {
  const headers = [
    `To: ${m.to.map(noBreaks).join(", ")}`,
    ...(m.cc.length ? [`Cc: ${m.cc.map(noBreaks).join(", ")}`] : []),
    ...(m.bcc.length ? [`Bcc: ${m.bcc.map(noBreaks).join(", ")}`] : []),
    `Subject: ${encodeHeader(noBreaks(m.subject))}`,
    ...m.extra.map(noBreaks),
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  const body = Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return Buffer.from(`${headers.join("\r\n")}\r\n\r\n${body}`, "utf8").toString("base64url");
}
