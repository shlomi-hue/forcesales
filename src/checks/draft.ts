// Every check gmail_draft runs, in one place. A draft is created only when all pass. Pure.

import { discountCheck, type DeclaredDiscount } from "./discount.js";
import { leakCheck, type OtherAccount } from "./leak.js";
import { pricingCheck, type DeclaredPrice } from "./pricing.js";
import type { RateCard } from "./rate-card.js";
import { recipientCheck } from "./recipient.js";
import { wordsCheck } from "./words.js";

export interface CheckRules {
  maxDiscountPercent?: number;
  banned: string[];
  accounts: OtherAccount[];
}

export interface DraftCheckInput {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  prices: DeclaredPrice[];
  discounts: DeclaredDiscount[];
  card: RateCard | null;
  rules: CheckRules;
  ownEmail: string;
  threadParticipants: string[] | null;
  knownAddresses: string[];
  internalIds: string[];
}

export function draftChecks(i: DraftCheckInput): { ok: boolean; reasons: string[] } {
  const results: [string, { ok: boolean; reasons: string[] }][] = [
    ["recipient", recipientCheck({ to: i.to, cc: i.cc, bcc: i.bcc, ownEmail: i.ownEmail, threadParticipants: i.threadParticipants, knownAddresses: i.knownAddresses })],
    ["pricing", pricingCheck({ body: `${i.subject}\n${i.body}`, prices: i.prices, card: i.card })],
    ["discount", discountCheck({ body: `${i.subject}\n${i.body}`, discounts: i.discounts, card: i.card, rules: { maxPercent: i.rules.maxDiscountPercent } })],
    ["words", wordsCheck({ body: i.body, subject: i.subject, banned: i.rules.banned })],
    [
      "leak",
      leakCheck({
        body: i.body,
        subject: i.subject,
        recipients: [...i.to, ...i.cc, ...i.bcc],
        ownEmail: i.ownEmail,
        internalIds: i.internalIds,
        accounts: i.rules.accounts,
        threadParticipants: i.threadParticipants ?? [],
      }),
    ],
  ];
  const reasons = results.flatMap(([name, r]) => r.reasons.map((reason) => `[${name}] ${reason}`));
  return { ok: reasons.length === 0, reasons };
}
