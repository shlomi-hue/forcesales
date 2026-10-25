import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dataDir, ensureDataFolder, safePath } from "../../src/data/folder.js";
import { tempDataDir } from "../tools/fake-google.js";

describe("data folder", () => {
  it("defaults to ~/deal-harness-data and honors DEAL_HARNESS_DATA", () => {
    expect(dataDir({})).toMatch(/deal-harness-data$/);
    expect(dataDir({ DEAL_HARNESS_DATA: "/tmp/x" })).toBe("/tmp/x");
  });

  it("is created from the template with git and a .gitignore", async () => {
    const dir = tempDataDir();
    expect(await ensureDataFolder(dir)).toBe(true);
    expect(existsSync(join(dir, "company", "voice.md"))).toBe(true);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toContain("config.local.md");
    expect(existsSync(join(dir, "gitignore"))).toBe(false);
    expect(execFileSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" })).toContain("Start deal harness data folder");
    expect(await ensureDataFolder(dir)).toBe(false);
  });

  it("keeps paths inside the folder and away from the user's own files", () => {
    const dir = "/data";
    expect(safePath(dir, "memory/accounts/acme.md", { write: true }).rel).toBe("memory/accounts/acme.md");
    expect(safePath(dir, "./company//voice.md").rel).toBe("company/voice.md");
    for (const bad of ["../etc/passwd", "/etc/passwd", "memory/../../x.md", ".git/config"]) expect(() => safePath(dir, bad), bad).toThrow();
    for (const mine of ["config.md", "company/playbook.md", "memory/lessons/accepted.md"]) {
      expect(() => safePath(dir, mine, { write: true }), mine).toThrow(/belongs to you/);
    }
    expect(() => safePath(dir, "memory/x.txt", { write: true })).toThrow(/\.md/);
    expect(() => safePath(dir, "notes.md", { write: true })).toThrow(/under memory\/ or company\//);
  });
});
