// recipient.check: a draft only goes to people already in the conversation,
// or, for a new email, to people the user has written to before. Pure.

import { addressesIn, companyDomain } from "./addresses.js";
import type { CheckResult } from "./pricing.js";

export interface RecipientInput {
  to: string[];
  cc: string[];
  bcc: string[];
  ownEmail: string;
  // Everyone on the thread (From, To, Cc of every message), for a reply. null for a new email.
  threadParticipants: string[] | null;
  // Addresses the user has sent mail to before, and their company domains.
  knownAddresses: string[];
  maxRecipients?: number;
}

export function recipientCheck(input: RecipientInput): CheckResult {
  const reasons: string[] = [];
  const own = input.ownEmail.toLowerCase();
  const ownDomain = companyDomain(own);
  const isOwn = (a: string) => a === own || (ownDomain !== null && companyDomain(a) === ownDomain);

  const allowed = (input.threadParticipants ?? input.knownAddresses).map((a) => a.toLowerCase());
  const allowedDomains = new Set(allowed.map(companyDomain).filter((d): d is string => d !== null));
  const where = input.threadParticipants ? "isn't on this thread" : "has never been emailed from this account";

  const all: { field: string; raw: string }[] = [
    ...input.to.map((raw) => ({ field: "to", raw })),
    ...input.cc.map((raw) => ({ field: "cc", raw })),
    ...input.bcc.map((raw) => ({ field: "bcc", raw })),
  ];
  const max = input.maxRecipients ?? 20;
  if (all.length > max) reasons.push(`${all.length} recipients; the limit is ${max}.`);

  for (const { field, raw } of all) {
    const [address, ...extra] = addressesIn(raw);
    if (!address || extra.length > 0) {
      reasons.push(`"${raw}" in ${field} isn't one email address.`);
      continue;
    }
    if (isOwn(address)) continue;
    if (field === "bcc") {
      reasons.push(`Bcc to ${address}: hidden copies only go to your own address or domain.`);
      continue;
    }
    const domain = companyDomain(address);
    if (allowed.includes(address) || (domain !== null && allowedDomains.has(domain))) continue;
    reasons.push(`${address} ${where}, and nobody from ${domain ?? "that address"} is either. Add new people yourself in Gmail.`);
  }
  return { ok: reasons.length === 0, reasons };
}
