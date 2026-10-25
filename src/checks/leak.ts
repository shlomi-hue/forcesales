// leak.check: the draft gives away nothing internal: floors, margins, deal notes, the
// rate card, local files, or other people's addresses and other customers' names. Pure.

import { addressesIn, companyDomain } from "./addresses.js";
import type { CheckResult } from "./pricing.js";

const INTERNAL_TERMS = [
  "floor price", "price floor", "our floor", "walk-away", "walk away price", "walkaway", "our minimum",
  "lowest we can go", "lowest we can do", "bottom line price", "our margin", "our cost",
  "internal only", "internal use", "rate card",
  "price list internal", "win probability", "close probability", "likelihood to close", "chance of closing",
  "deal score", "pre-mortem", "decision map", "battle card", "battlecard", "our notes", "deal notes",
  "deal-harness", "outside_data",
];

export interface OtherAccount {
  name: string;
  domains: string[];
}

export interface LeakInput {
  body: string;
  subject?: string;
  recipients: string[];
  ownEmail: string;
  // Rate card and other internal Sheet or Drive ids that must never show up in a draft.
  internalIds: string[];
  // Other customers from memory. A draft may name a customer only when writing to them.
  accounts: OtherAccount[];
  // Addresses already on the thread; quoting them back is fine.
  threadParticipants?: string[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (p: string) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(p).replace(/[\s-]+/g, "[\\s-]+")}(?![\\p{L}\\p{N}])`, "iu");

export function leakCheck(input: LeakInput): CheckResult {
  const text = `${input.subject ?? ""}\n${input.body}`;
  const reasons: string[] = [];

  // One mention per spot: "our floor price" reports once, not as "our floor" and "floor price".
  const hits: { at: number; end: number; raw: string }[] = [];
  for (const term of INTERNAL_TERMS) {
    const m = wordRe(term).exec(text);
    if (!m) continue;
    const at = m.index;
    const end = at + m[0].length;
    if (hits.some((h) => at < h.end && end > h.at)) continue;
    hits.push({ at, end, raw: m[0] });
  }
  for (const h of hits.sort((a, b) => a.at - b.at)) reasons.push(`Mentions "${h.raw}", which is internal.`);
  if (/<<<\s*(END_)?OUTSIDE[_-]DATA/i.test(text)) reasons.push("Contains a raw data block copied from a tool result.");

  for (const id of input.internalIds.filter((i) => i.length >= 10)) {
    if (text.includes(id)) reasons.push("Links to the rate card or another internal file.");
  }
  const localPath = text.match(/(?:file:\/\/|~\/deal-harness-data|\/Users\/\w+|\/home\/\w+|[A-Z]:\\Users\\)\S*/);
  if (localPath) reasons.push(`Contains a local file path: "${localPath[0]}".`);

  const recipientAddrs = input.recipients.flatMap(addressesIn);
  const okAddrs = new Set([...recipientAddrs, ...(input.threadParticipants ?? []).flatMap(addressesIn), input.ownEmail.toLowerCase()]);
  const okDomains = new Set([...okAddrs].map(companyDomain).filter((d): d is string => d !== null));
  for (const a of addressesIn(text)) {
    const d = companyDomain(a);
    if (okAddrs.has(a) || (d !== null && okDomains.has(d))) continue;
    reasons.push(`Contains ${a}, who isn't part of this conversation.`);
  }

  const recipientDomains = new Set(recipientAddrs.map(companyDomain).filter((d): d is string => d !== null));
  for (const acct of input.accounts) {
    if (acct.domains.some((d) => recipientDomains.has(d.toLowerCase()))) continue;
    if (acct.name.trim().length >= 3 && wordRe(acct.name.trim()).test(text)) {
      reasons.push(`Names ${acct.name}, another customer.`);
    }
  }
  return { ok: reasons.length === 0, reasons };
}
