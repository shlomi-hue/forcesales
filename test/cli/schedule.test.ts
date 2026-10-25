import { describe, expect, it } from "vitest";
import { claudeArgs } from "../../src/cli/run.js";
import { cronBlock, launchdPlist, mergeCrontab } from "../../src/cli/schedule.js";

describe("scheduler", () => {
  it("writes a launchd job that runs at the set time", () => {
    const plist = launchdPlist("prep", "18:05", { PATH: "/usr/bin", DEAL_HARNESS_DATA: "/Users/me/deal data & co" });
    expect(plist).toContain("<string>com.deal-harness.prep</string>");
    expect(plist).toContain("<key>Hour</key><integer>18</integer><key>Minute</key><integer>5</integer>");
    expect(plist).toContain("<string>run</string>\n      <string>prep</string>");
    expect(plist).toContain("deal data &amp; co");
  });

  it("swaps its cron block in and out without touching other lines", () => {
    const block = cronBlock({ prep: "18:00", nag: "08:30" }, { PATH: "/bin" });
    expect(block).toMatch(/^# deal-harness begin\n0 18 \* \* \* PATH='\/bin' .* run prep >> .*\n30 8 \* \* \* .* run nag >> .*\n# deal-harness end$/);
    const mine = "MAILTO=me\n5 * * * * backup.sh\n";
    const installed = mergeCrontab(mine, block);
    expect(installed.startsWith(mine)).toBe(true);
    expect(mergeCrontab(installed, block)).toBe(installed);
    expect(mergeCrontab(installed, null)).toBe(mine);
  });

  it("runs Claude Code headless with only this harness's tools", () => {
    const args = claudeArgs("nag");
    expect(args[0]).toBe("-p");
    expect(args[1]).toContain("Use the nag skill");
    expect(args).toContain("--strict-mcp-config");
    expect(args.slice(args.indexOf("--allowedTools") + 1)).toEqual(["mcp__deal-harness", "Skill"]);
    expect(JSON.parse(args[args.indexOf("--mcp-config") + 1] ?? "")).toMatchObject({ mcpServers: { "deal-harness": { args: [expect.stringMatching(/dist\/cli\/index\.js$/), "serve"] } } });
  });
});
