// mail_scan: past mail grouped by the outside company it was with. Only threads the user wrote
// in count (that's where deals are); free-mail (personal) addresses, newsletters and automated
// senders are left out. Thread details are cached in <data>/scan/ so a re-run only fetches new mail.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { addressesIn, companyDomain } from "../checks/addresses.js";
import { dataBlock } from "../server/data-block.js";
import { bodyText, header, type Gmail } from "./gmail.js";

export interface ScanOptions {
  months: number;
  excludeDomains: string[];
  excludeLabels: string[];
  maxThreads: number;
  top: number;
}

interface ThreadInfo {
  historyId: string;
  participants: string[];
  messages: number;
  mine: number;
  first: string;
  last: string;
  subject: string;
  bulk: boolean;
}

export interface DomainSummary {
  domain: string;
  threads: number;
  myMessages: number;
  first: string;
  last: string;
  contacts: [string, number][];
  subjects: string[];
  threadIds: string[];
}

const AUTOMATED = /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce[s]?|alerts?|news(letter)?|marketing|info|support|billing|invoices?|receipts?|calendar|updates?)([+.-].*)?@/i;

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i] as T);
      }
    }),
  );
  return out;
}

const day = (ms: string | null | undefined) => (ms ? new Date(Number(ms)).toISOString().slice(0, 10) : "");

export async function scanMail(gmail: Gmail, dir: string, opts: ScanOptions): Promise<{ domains: DomainSummary[]; scanned: number; fetched: number; ownEmail: string }> {
  const ownEmail = (await gmail.users.getProfile({ userId: "me" })).data.emailAddress?.toLowerCase() ?? "";
  const ownDomain = companyDomain(ownEmail);
  const labels = opts.excludeLabels.map((l) => ` -label:"${l.replace(/"/g, "")}"`).join("");
  const q = `in:sent newer_than:${opts.months}m${labels}`;

  const listed: { id: string; historyId: string }[] = [];
  let pageToken: string | undefined;
  do {
    const res = await gmail.users.threads.list({ userId: "me", q, maxResults: 500, ...(pageToken ? { pageToken } : {}) });
    for (const t of res.data.threads ?? []) if (t.id) listed.push({ id: t.id, historyId: t.historyId ?? "" });
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken && listed.length < opts.maxThreads);
  const threads = listed.slice(0, opts.maxThreads);

  const cacheDir = join(dir, "scan");
  const cacheFile = join(cacheDir, "threads.json");
  const cache: Record<string, ThreadInfo> = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, "utf8")) as Record<string, ThreadInfo>) : {};
  const stale = threads.filter((t) => cache[t.id]?.historyId !== t.historyId || !t.historyId);

  await pool(stale, 8, async (t) => {
    const { data } = await gmail.users.threads.get({
      userId: "me",
      id: t.id,
      format: "metadata",
      metadataHeaders: ["From", "To", "Cc", "Subject", "List-Unsubscribe", "Precedence"],
    });
    const msgs = data.messages ?? [];
    const participants = [...new Set(msgs.flatMap((m) => ["From", "To", "Cc"].flatMap((h) => addressesIn(header(m, h)))))];
    cache[t.id] = {
      historyId: t.historyId,
      participants,
      messages: msgs.length,
      mine: msgs.filter((m) => addressesIn(header(m, "From"))[0] === ownEmail).length,
      first: day(msgs[0]?.internalDate),
      last: day(msgs.at(-1)?.internalDate),
      subject: header(msgs[0], "Subject").slice(0, 120),
      bulk: msgs.some((m) => header(m, "List-Unsubscribe") !== "" || /bulk|list/i.test(header(m, "Precedence"))),
    };
  });
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache));

  const excluded = new Set(opts.excludeDomains.map((d) => d.toLowerCase().replace(/^@/, "")));
  const isExcluded = (d: string) => [...excluded].some((x) => d === x || d.endsWith(`.${x}`));
  const byDomain = new Map<string, DomainSummary & { contactCounts: Map<string, number> }>();
  for (const t of threads) {
    const info = cache[t.id];
    if (!info || info.bulk || info.mine === 0) continue;
    const external = info.participants.filter((a) => {
      const d = companyDomain(a);
      return d !== null && d !== ownDomain && !isExcluded(d) && !AUTOMATED.test(a);
    });
    for (const domain of new Set(external.map((a) => companyDomain(a) as string))) {
      const s = byDomain.get(domain) ?? {
        domain, threads: 0, myMessages: 0, first: info.first, last: info.last,
        contacts: [] as [string, number][], subjects: [] as string[], threadIds: [] as string[], contactCounts: new Map<string, number>(),
      };
      s.threads++;
      s.myMessages += info.mine;
      if (info.first && (!s.first || info.first < s.first)) s.first = info.first;
      if (info.last > s.last) s.last = info.last;
      s.threadIds.push(t.id);
      if (info.subject && s.subjects.length < 5) s.subjects.push(info.subject);
      for (const a of external.filter((x) => companyDomain(x) === domain)) s.contactCounts.set(a, (s.contactCounts.get(a) ?? 0) + 1);
      byDomain.set(domain, s);
    }
  }
  const domains = [...byDomain.values()]
    .map(({ contactCounts, ...s }) => ({ ...s, contacts: [...contactCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5) }))
    .sort((a, b) => b.threads - a.threads || b.myMessages - a.myMessages);
  return { domains, scanned: threads.length, fetched: stale.length, ownEmail };
}

export function scanTable(domains: DomainSummary[], opts: ScanOptions, today: string): string {
  return [
    "# Mail scan",
    "",
    `Scanned ${today}: threads you wrote in over the last ${opts.months} months, grouped by outside company. Personal (free-mail) addresses, newsletters and automated senders are left out${opts.excludeDomains.length ? `, and so are ${opts.excludeDomains.join(", ")}` : ""}.`,
    "",
    "| Domain | Threads | Your messages | First | Last |",
    "|---|---|---|---|---|",
    ...domains.map((d) => `| ${d.domain} | ${d.threads} | ${d.myMessages} | ${d.first} | ${d.last} |`),
    "",
  ].join("\n");
}

export function scanReport(r: { domains: DomainSummary[]; scanned: number; fetched: number }, top: number): string {
  const head = `${r.scanned} sent threads scanned (${r.fetched} fetched, the rest from cache). ${r.domains.length} outside companies.`;
  const rows = r.domains.slice(0, top).map(
    (d) =>
      `domain: ${d.domain}\nthreads: ${d.threads} · your messages: ${d.myMessages} · ${d.first} to ${d.last}\ncontacts: ${d.contacts.map(([a, n]) => `${a} (${n})`).join(", ")}\nsubjects: ${d.subjects.join(" | ")}\nthread_ids: ${d.threadIds.slice(0, 10).join(", ")}`,
  );
  const more = r.domains.length > top ? `\n\n(${r.domains.length - top} more companies with fewer threads; ask for more with a larger top.)` : "";
  return `${head}\n\n${dataBlock("gmail/scan", rows.join("\n\n"))}${more}`;
}

// The user's own sent emails to outside companies, quoted replies cut, to learn their voice from.
export async function sentSamples(gmail: Gmail, months: number, count: number): Promise<string> {
  const ownEmail = (await gmail.users.getProfile({ userId: "me" })).data.emailAddress?.toLowerCase() ?? "";
  const ownDomain = companyDomain(ownEmail);
  const list = await gmail.users.messages.list({ userId: "me", q: `in:sent newer_than:${months}m`, maxResults: Math.min(500, count * 4) });
  const samples: string[] = [];
  for (const m of list.data.messages ?? []) {
    if (samples.length >= count) break;
    const { data } = await gmail.users.messages.get({ userId: "me", id: m.id ?? "", format: "full" });
    const to = [header(data, "To"), header(data, "Cc")].flatMap(addressesIn);
    if (!to.some((a) => {
      const d = companyDomain(a);
      return d !== null && d !== ownDomain;
    })) continue;
    const body = ownWords(bodyText(data.payload));
    if (body.length < 40) continue;
    samples.push(`subject: ${header(data, "Subject")}\n\n${body.slice(0, 1500)}`);
  }
  if (samples.length === 0) return "No sent emails to outside companies found in that window.";
  return dataBlock("gmail/sent-samples", samples.join("\n\n---\n\n"));
}

// Cut quoted replies and forwarded text, keeping only what the user wrote.
export function ownWords(body: string): string {
  const lines = body.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line) || /^-{2,}\s*(Original|Forwarded) Message/i.test(line) || /^From: .+/.test(line) || /^>/.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}
