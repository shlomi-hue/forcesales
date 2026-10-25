// The Google refresh token lives in the OS keychain only. Never in files or logs.

import { Entry } from "@napi-rs/keyring";

export interface TokenStore {
  get(): string | null;
  set(token: string): void;
  clear(): boolean;
}

const SERVICE = "deal-harness";
const ACCOUNT = "google-refresh-token";

export function keychainStore(): TokenStore {
  const entry = new Entry(SERVICE, ACCOUNT);
  return {
    get: () => entry.getPassword(),
    set: (token) => entry.setPassword(token),
    clear: () => entry.deletePassword(),
  };
}
