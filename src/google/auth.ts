// Google sign-in with a Desktop OAuth client the user creates in their own Cloud project.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { CodeChallengeMethod, OAuth2Client } from "google-auth-library";
import type { TokenStore } from "./token-store.js";

// gmail.compose also allows sending; the server simply has no code that sends.
export const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

interface ClientSecrets {
  client_id: string;
  client_secret: string;
}

export function readClientSecrets(path: string | undefined): ClientSecrets {
  if (!path) {
    throw new Error(
      "DEAL_HARNESS_OAUTH_CLIENT is not set. Point it at the client JSON you downloaded for your Desktop OAuth client.",
    );
  }
  let json: { installed?: ClientSecrets; web?: ClientSecrets };
  try {
    json = JSON.parse(readFileSync(path, "utf8")) as typeof json;
  } catch {
    throw new Error(`Can't read the OAuth client file at ${path} (DEAL_HARNESS_OAUTH_CLIENT).`);
  }
  const secrets = json.installed ?? json.web;
  if (!secrets?.client_id || !secrets.client_secret) {
    throw new Error(`${path} doesn't look like an OAuth client file (no installed.client_id).`);
  }
  return secrets;
}

export class NotSignedIn extends Error {
  constructor() {
    super("Not signed in to Google. Run `deal-harness login` in a terminal, then try again.");
  }
}

// An authorized client for API calls. Access tokens stay in memory.
export function authorizedClient(clientPath: string | undefined, store: TokenStore): OAuth2Client {
  const { client_id, client_secret } = readClientSecrets(clientPath);
  const refresh = store.get();
  if (!refresh) throw new NotSignedIn();
  const client = new OAuth2Client({ clientId: client_id, clientSecret: client_secret });
  client.setCredentials({ refresh_token: refresh });
  client.on("tokens", (t) => {
    if (t.refresh_token) store.set(t.refresh_token);
  });
  return client;
}

// Loopback sign-in: opens the browser, waits for Google to redirect to 127.0.0.1.
export async function login(clientPath: string | undefined, store: TokenStore, log: (s: string) => void): Promise<void> {
  const { client_id, client_secret } = readClientSecrets(clientPath);
  const state = randomBytes(16).toString("hex");

  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Couldn't open a local port for sign-in.");
  const redirectUri = `http://127.0.0.1:${address.port}`;

  const client = new OAuth2Client({ clientId: client_id, clientSecret: client_secret, redirectUri });
  const { codeVerifier, codeChallenge } = await client.generateCodeVerifierAsync();
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: CodeChallengeMethod.S256,
  });

  log(`Opening your browser to sign in to Google. If it doesn't open, visit:\n${url}\n`);
  openBrowser(url);

  const code = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Sign-in timed out after 5 minutes.")), 5 * 60_000);
    server.on("request", (req, res) => {
      const params = new URL(req.url ?? "/", redirectUri).searchParams;
      if (!params.has("code") && !params.has("error")) {
        res.writeHead(404).end();
        return;
      }
      const ok = params.get("state") === state && params.get("code");
      res.writeHead(ok ? 200 : 400, { "content-type": "text/plain; charset=utf-8" });
      res.end(ok ? "Signed in. You can close this tab." : "Sign-in failed. Check the terminal.");
      clearTimeout(timer);
      if (ok) resolve(params.get("code") as string);
      else reject(new Error(params.get("error") ?? "Sign-in response didn't match this request."));
    });
  }).finally(() => server.close());

  const { tokens } = await client.getToken({ code, codeVerifier });
  if (!tokens.refresh_token) throw new Error("Google didn't return a refresh token. Remove the app's access at myaccount.google.com/permissions and run login again.");
  store.set(tokens.refresh_token);
  log("Signed in. The token is saved in your OS keychain.");
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  } catch {
    // The URL is printed; the user can open it by hand.
  }
}
