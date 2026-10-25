// Email address helpers shared by the recipient and leak checks. Pure.

const FREE_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.net",
  "yandex.com", "mail.com", "zoho.com", "qq.com", "163.com", "126.com", "naver.com",
]);

const ADDRESS_RE = /[\w.!#$%&'*+/=?^`{|}~-]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}/gi;

// "Dana Lee <dana@acme.com>, bob@x.com" -> ["dana@acme.com", "bob@x.com"]
export function addressesIn(text: string): string[] {
  return [...new Set((text.match(ADDRESS_RE) ?? []).map((a) => a.toLowerCase()))];
}

export const domainOf = (address: string) => address.slice(address.lastIndexOf("@") + 1).toLowerCase();

export const isFreeMail = (domain: string) => FREE_MAIL.has(domain.toLowerCase());

// The company domain of an address, or null for free mail (gmail.com tells you nothing about who it is).
export function companyDomain(address: string): string | null {
  const d = domainOf(address);
  return isFreeMail(d) ? null : d;
}
