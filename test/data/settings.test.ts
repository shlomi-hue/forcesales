import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ensureDataFolder } from "../../src/data/folder.js";
import { knownAccounts, loadConfig, loadRules, neverSay, parseSettings } from "../../src/data/settings.js";
import { DEFAULT_BANNED } from "../../src/checks/words.js";
import { tempDataDir } from "../tools/fake-google.js";

describe("settings", () => {
  it("reads '- key: value' lines and skips empty ones and comments", () => {
    expect(parseSettings("# x\n- Rate card sheet: `abc`\n- range:\n<!-- - max discount: 99 -->\n* Max discount: 10%")).toEqual({
      "rate card sheet": "abc",
      "max discount": "10%",
    });
  });

  it("layers config.md, then config.local.md, then the environment", async () => {
    const dir = tempDataDir();
    await ensureDataFolder(dir);
    writeFileSync(join(dir, "config.md"), "- rate card sheet: https://docs.google.com/spreadsheets/d/SHEET_FROM_FILE/edit\n- max discount: 10%\n");
    writeFileSync(join(dir, "config.local.md"), "- oauth client: /keys/client.json\n- max discount: 12\n");
    const c = loadConfig(dir, {});
    expect(c).toMatchObject({ rateCardSheet: "SHEET_FROM_FILE", maxDiscountPercent: 12, oauthClientPath: "/keys/client.json" });
    expect(loadConfig(dir, { DEAL_HARNESS_MAX_DISCOUNT: "5" }).maxDiscountPercent).toBe(5);
  });

  it("reads never-say phrases from voice.md", () => {
    expect(neverSay("# Voice\n## Tone\n- warm\n## Never say\n<!-- comment -->\n- \"circle back\"\n- synergy\n## Other\n- x")).toEqual(["circle back", "synergy"]);
  });

  it("reads accounts with their domains, and builds the check rules", async () => {
    const dir = tempDataDir();
    await ensureDataFolder(dir);
    mkdirSync(join(dir, "memory", "accounts"), { recursive: true });
    writeFileSync(join(dir, "memory", "accounts", "acme.md"), "# Acme Corp\ndomains: acme.example, @acme.co\n");
    writeFileSync(join(dir, "company", "voice.md"), "## Never say\n- circle back\n");
    expect(knownAccounts(dir)).toEqual([{ name: "Acme Corp", domains: ["acme.example", "acme.co"] }]);
    const rules = loadRules(dir, loadConfig(dir, {}));
    expect(rules.banned).toEqual([...DEFAULT_BANNED, "circle back"]);
    expect(rules.maxDiscountPercent).toBe(10);
  });
});
