import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_FORMAT, ensureDataFolder } from "../../src/data/folder.js";
import { CURRENT_FORMAT, FORMAT_FILE, migrate, readFormat } from "../../src/data/migrations.js";
import {
  addJsonServer, addTomlServer, claudeAddArgs, configFile, jsonServer, removeJsonServer, removeTomlServer, skillsDir, tomlServer, type Place,
} from "../../src/install/apps.js";
import { checkApp, configure, unconfigure, type Runner, type SetupDeps } from "../../src/install/setup.js";
import { installSkills, MARKER, removeSkills, skillNames, staleSkills } from "../../src/install/skills.js";
import { crc32, zip } from "../../src/install/zip.js";
import { tempDataDir } from "../tools/fake-google.js";

const cmd = { command: "/opt/node/bin/node", args: ["/Users/Jane Doe/.deal-harness/app/node_modules/deal-harness/dist/cli/index.js", "serve"] };
const tmp = () => mkdtempSync(join(tmpdir(), "dh-install-"));

describe("Codex config.toml", () => {
  const existing = 'model = "o5"\n\n[mcp_servers.other]\ncommand = "other"\n\n[profiles.fast]\nmodel = "mini"\n';

  it("adds the server table, keeping everything else, and reads it back", () => {
    const out = addTomlServer(existing, cmd);
    expect(out).toContain('[mcp_servers.other]\ncommand = "other"');
    expect(out).toContain('[profiles.fast]\nmodel = "mini"');
    expect(out.endsWith('[mcp_servers.deal-harness]\ncommand = "/opt/node/bin/node"\nargs = ["/Users/Jane Doe/.deal-harness/app/node_modules/deal-harness/dist/cli/index.js", "serve"]\n')).toBe(true);
    expect(tomlServer(out)).toEqual(cmd);
  });

  it("replaces its own table instead of adding a second one, and removes it cleanly", () => {
    const twice = addTomlServer(addTomlServer(existing, cmd), { command: "node2", args: ["x"] });
    expect(twice.match(/\[mcp_servers\.deal-harness\]/g)).toHaveLength(1);
    expect(tomlServer(twice)).toEqual({ command: "node2", args: ["x"] });
    const mid = `${addTomlServer("", cmd)}\n[profiles.fast]\nmodel = "mini"\n`;
    const r = removeTomlServer(mid);
    expect(r.removed).toBe(true);
    expect(r.text.trim()).toBe('[profiles.fast]\nmodel = "mini"');
    expect(removeTomlServer(existing)).toEqual({ text: existing, removed: false });
  });

  it("escapes Windows paths and writes env", () => {
    const out = addTomlServer("", { command: "C:\\Program Files\\nodejs\\node.exe", args: ["serve"], env: { DEAL_HARNESS_DATA: "D:\\deals" } });
    expect(out).toContain('command = "C:\\\\Program Files\\\\nodejs\\\\node.exe"');
    expect(out).toContain('env = { "DEAL_HARNESS_DATA" = "D:\\\\deals" }');
    expect(tomlServer(out)?.command).toBe("C:\\Program Files\\nodejs\\node.exe");
  });
});

describe("JSON configs (Claude Desktop, Gemini CLI)", () => {
  it("adds and removes the server, keeping other settings and servers", () => {
    const before = JSON.stringify({ theme: "dark", mcpServers: { other: { command: "x" } } });
    const out = addJsonServer(before, "settings.json", cmd);
    expect(JSON.parse(out)).toEqual({ theme: "dark", mcpServers: { other: { command: "x" }, "deal-harness": cmd } });
    expect(jsonServer(out, "f")).toEqual(cmd);
    const r = removeJsonServer(out, "f");
    expect(JSON.parse(r.text)).toEqual({ theme: "dark", mcpServers: { other: { command: "x" } } });
    expect(addJsonServer("", "f", cmd)).toContain('"deal-harness"');
  });

  it("refuses to rewrite a file it can't parse", () => {
    expect(() => addJsonServer('{ // comment\n "a": 1 }', "settings.json", cmd)).toThrow(/isn't plain JSON/);
  });
});

describe("app locations", () => {
  const p = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv = {}): Place => ({ home: "/h", platform, env });
  it("follows each app's documented paths", () => {
    expect(configFile("claude-desktop", p("darwin"))).toBe("/h/Library/Application Support/Claude/claude_desktop_config.json");
    expect(configFile("claude-desktop", p("win32", { APPDATA: "C:/Users/j/AppData/Roaming" }))).toBe(join("C:/Users/j/AppData/Roaming", "Claude", "claude_desktop_config.json"));
    expect(configFile("codex", p("linux"))).toBe("/h/.codex/config.toml");
    expect(configFile("codex", p("linux", { CODEX_HOME: "/c" }))).toBe("/c/config.toml");
    expect(configFile("gemini", p("linux"))).toBe("/h/.gemini/settings.json");
    expect(skillsDir("claude-code", p("linux"))).toBe("/h/.claude/skills");
    expect(skillsDir("codex", p("linux"))).toBe("/h/.agents/skills");
    expect(skillsDir("gemini", p("linux"))).toBe("/h/.agents/skills");
    expect(skillsDir("claude-desktop", p("darwin"))).toBeNull();
  });

  it("adds Claude Code's server at user scope, with env when set", () => {
    expect(claudeAddArgs({ ...cmd, env: { DEAL_HARNESS_DATA: "/d" } })).toEqual(["mcp", "add", "-s", "user", "-e", "DEAL_HARNESS_DATA=/d", "deal-harness", "--", ...[cmd.command, ...cmd.args]]);
  });
});

describe("zip", () => {
  it("computes CRC-32 and writes a zip that unzip accepts", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
    const dir = tmp();
    const file = join(dir, "s.zip");
    writeFileSync(file, zip([{ name: "nag/SKILL.md", data: Buffer.from("---\nname: nag\n---\nhi") }, { name: "nag/ref/x.md", data: Buffer.from("x") }]));
    const listing = execFileSync("python3", ["-I", "-c", "import sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(','.join(z.namelist())); print(z.read('nag/SKILL.md').decode())", file], { encoding: "utf8" });
    expect(listing).toContain("nag/SKILL.md,nag/ref/x.md");
    expect(listing).toContain("name: nag");
  });
});

describe("skills", () => {
  it("copies the shipped skills with a marker, leaves the user's own alone, and removes only its own", () => {
    const dest = join(tmp(), "skills");
    mkdirSync(join(dest, "nag"), { recursive: true });
    writeFileSync(join(dest, "nag", "SKILL.md"), "my own nag skill");
    const r = installSkills("skills", dest, "1.2.3");
    expect(r.skipped).toEqual(["nag"]);
    expect(r.installed).toEqual(skillNames("skills").filter((n) => n !== "nag"));
    expect(readFileSync(join(dest, "account", MARKER), "utf8")).toBe("1.2.3\n");
    expect(staleSkills("skills", dest)).toEqual({ missing: [], outdated: [], notOurs: ["nag"] });
    writeFileSync(join(dest, "account", "SKILL.md"), "old");
    expect(staleSkills("skills", dest).outdated).toEqual(["account"]);
    expect(installSkills("skills", dest, "1.2.4").installed).toContain("account");
    expect(removeSkills("skills", dest)).not.toContain("nag");
    expect(readFileSync(join(dest, "nag", "SKILL.md"), "utf8")).toBe("my own nag skill");
    expect(existsSync(join(dest, "account"))).toBe(false);
  });
});

describe("data folder migrations", () => {
  it("new folders start at the current format", async () => {
    expect(DATA_FORMAT).toBe(CURRENT_FORMAT);
    const dir = tempDataDir();
    await ensureDataFolder(dir);
    expect(readFormat(dir)).toBe(CURRENT_FORMAT);
    expect((await migrate(dir)).changes).toEqual([]);
  });

  it("brings an old folder up: ignores and untracks pending drafts, adds new template files, keeps the user's files", async () => {
    const dir = tempDataDir();
    await ensureDataFolder(dir);
    // An old folder: no format file, an old .gitignore, a tracked pending.json, a missing template file, an edited voice.md.
    const git = (...a: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8" });
    writeFileSync(join(dir, FORMAT_FILE), "0\n");
    writeFileSync(join(dir, ".gitignore"), "config.local.md\nindex.sqlite\n");
    writeFileSync(join(dir, "memory/edits/pending.json"), "[]\n");
    writeFileSync(join(dir, "company/voice.md"), "# Voice\nmine\n");
    execFileSync("rm", [join(dir, "memory/lessons/proposed.md")]);
    git("add", "-A");
    git("commit", "-qm", "old");
    const m = await migrate(dir);
    expect(m).toMatchObject({ from: 0, to: CURRENT_FORMAT });
    expect(m.changes).toContain(".gitignore: memory/edits/pending.json");
    expect(m.changes).toContain("memory/lessons/proposed.md");
    expect(m.changes.some((c) => c.startsWith("untracked memory/edits/pending.json"))).toBe(true);
    expect(readFileSync(join(dir, ".gitignore"), "utf8")).toMatch(/^config\.local\.md\nindex\.sqlite\n.*memory\/edits\/pending\.json\n$/s);
    expect(readFileSync(join(dir, "company/voice.md"), "utf8")).toBe("# Voice\nmine\n");
    expect(git("ls-files", "memory/edits/pending.json")).toBe("");
    expect(existsSync(join(dir, "memory/edits/pending.json"))).toBe(true);
    expect(git("status", "--porcelain")).toBe("");
    expect((await migrate(dir)).changes).toEqual([]);
  });
});

describe("setting up apps in a temp home", () => {
  function setup(installed: string[] = ["claude", "codex", "gemini"]) {
    const home = tmp();
    const calls: string[][] = [];
    const claude = new Map<string, string>();
    const run: Runner = (c, args) => {
      calls.push([c, ...args]);
      if (!installed.includes(c)) return { ok: false, out: "not found" };
      if (c === "claude" && args[1] === "add") {
        const i = args.indexOf("--");
        claude.set("deal-harness", `Command: ${args[i + 1]}\nArgs: ${args.slice(i + 2).join(" ")}`);
      }
      if (c === "claude" && args[1] === "remove") return { ok: claude.delete("deal-harness"), out: "" };
      if (c === "claude" && args[1] === "get") return claude.has("deal-harness") ? { ok: true, out: claude.get("deal-harness") ?? "" } : { ok: false, out: "" };
      return { ok: true, out: "" };
    };
    const d: SetupDeps = { place: { home, platform: "darwin", env: {} }, run, skillsSource: "skills", version: "9.9.9" };
    return { home, d, calls };
  }

  it("configures every app, shares one skills folder for Codex and Gemini, and checks green", () => {
    const { home, d } = setup();
    mkdirSync(join(home, "Library", "Application Support", "Claude"), { recursive: true });
    writeFileSync(join(home, ".codex-config-placeholder"), "");
    const shared = new Set<string>();
    const lines = (["claude-code", "claude-desktop", "codex", "gemini"] as const).flatMap((a) => configure(a, d, cmd, shared));
    expect(lines.join("\n")).toMatch(/Gemini CLI: uses the same skills folder/);
    expect(lines.join("\n")).toMatch(/Upload the \d+ zips/);
    expect(existsSync(join(home, ".deal-harness", "desktop-skills", "proposal.zip"))).toBe(true);
    expect(tomlServer(readFileSync(join(home, ".codex", "config.toml"), "utf8"))).toEqual(cmd);
    expect(jsonServer(readFileSync(join(home, ".gemini", "settings.json"), "utf8"), "f")).toEqual(cmd);
    expect(existsSync(join(home, ".claude", "skills", "nag", "SKILL.md"))).toBe(true);
    expect(existsSync(join(home, ".agents", "skills", "nag", MARKER))).toBe(true);
    for (const a of ["claude-code", "codex", "gemini", "claude-desktop"] as const) {
      expect(checkApp(a, d, cmd).filter((c) => !c.ok), a).toEqual([]);
    }
    // A stale entry is caught.
    expect(checkApp("codex", d, { ...cmd, command: "/other/node" }).some((c) => !c.ok)).toBe(true);
  });

  it("uninstall takes out entries and its own skills only", () => {
    const { home, d } = setup();
    writeFileSync(join(home, "keep.txt"), "");
    const shared = new Set<string>();
    for (const a of ["claude-code", "codex", "gemini"] as const) configure(a, d, cmd, shared);
    writeFileSync(join(home, ".gemini", "settings.json"), addJsonServer(readFileSync(join(home, ".gemini", "settings.json"), "utf8"), "f", cmd).replace('"mcpServers"', '"theme": "dark", "mcpServers"'));
    const done = new Set<string>();
    const out = (["claude-code", "codex", "gemini", "claude-desktop"] as const).flatMap((a) => unconfigure(a, d, done));
    expect(out.join("\n")).toMatch(/Claude Code: removed the server/);
    expect(tomlServer(readFileSync(join(home, ".codex", "config.toml"), "utf8"))).toBeNull();
    expect(JSON.parse(readFileSync(join(home, ".gemini", "settings.json"), "utf8"))).toEqual({ theme: "dark", mcpServers: {} });
    expect(existsSync(join(home, ".agents", "skills", "nag"))).toBe(false);
    expect(existsSync(join(home, "keep.txt"))).toBe(true);
  });

  it("reports a failed Claude Code setup instead of claiming it", () => {
    const { d } = setup([]);
    expect(configure("claude-code", d, cmd, new Set())).toEqual(["Claude Code: couldn't add the server: not found"]);
  });
});
