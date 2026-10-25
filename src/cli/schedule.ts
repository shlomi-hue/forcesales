// Install or remove the evening /prep and morning /nag jobs: launchd on macOS, cron on Linux.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dataDir, ensureDataFolder } from "../data/folder.js";
import { JOBS, jobSettings, PACKAGE_ROOT, type Job } from "./run.js";

const CLI = join(PACKAGE_ROOT, "dist", "cli", "index.js");
const LABEL = (job: Job) => `com.deal-harness.${job}`;
const BEGIN = "# deal-harness begin";
const END = "# deal-harness end";

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function launchdPlist(job: Job, time: string, env: Record<string, string>): string {
  const [h, m] = time.split(":").map(Number);
  const logs = join(homedir(), "Library", "Logs", "deal-harness");
  const envXml = Object.entries(env)
    .map(([k, v]) => `      <key>${xml(k)}</key><string>${xml(v)}</string>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>${LABEL(job)}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(process.execPath)}</string>
      <string>${xml(CLI)}</string>
      <string>run</string>
      <string>${job}</string>
    </array>
    <key>StartCalendarInterval</key>
    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>
    <key>EnvironmentVariables</key>
    <dict>
${envXml}
    </dict>
    <key>StandardOutPath</key><string>${xml(join(logs, `${job}.log`))}</string>
    <key>StandardErrorPath</key><string>${xml(join(logs, `${job}.log`))}</string>
  </dict>
</plist>
`;
}

const shq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

export function cronBlock(times: Record<Job, string>, env: Record<string, string>): string {
  const envPart = Object.entries(env)
    .map(([k, v]) => `${k}=${shq(v)}`)
    .join(" ");
  const lines = (Object.keys(JOBS) as Job[]).map((job) => {
    const [h, m] = (times[job] ?? JOBS[job].time).split(":").map(Number);
    return `${m} ${h} * * * ${envPart} ${shq(process.execPath)} ${shq(CLI)} run ${job} >> ${shq(join(homedir(), ".deal-harness-" + job + ".log"))} 2>&1`;
  });
  return [BEGIN, ...lines, END].join("\n");
}

// Swap our block in or out of an existing crontab, leaving everything else alone.
export function mergeCrontab(existing: string, block: string | null): string {
  const re = new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n?`, "g");
  const rest = existing.replace(re, "").replace(/\n*$/, "\n");
  return block ? `${rest === "\n" ? "" : rest}${block}\n` : rest === "\n" ? "" : rest;
}

export async function schedule(remove: boolean, log: (s: string) => void): Promise<void> {
  const dir = dataDir();
  await ensureDataFolder(dir);
  const { times } = jobSettings(dir);
  // Scheduled jobs start with an almost empty environment: pass on what the run needs.
  const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin", DEAL_HARNESS_DATA: dir };
  if (process.env.HOME) env.HOME = process.env.HOME;

  if (process.platform === "darwin") {
    const agents = join(homedir(), "Library", "LaunchAgents");
    mkdirSync(agents, { recursive: true });
    mkdirSync(join(homedir(), "Library", "Logs", "deal-harness"), { recursive: true });
    for (const job of Object.keys(JOBS) as Job[]) {
      const plist = join(agents, `${LABEL(job)}.plist`);
      if (existsSync(plist)) {
        try {
          execFileSync("launchctl", ["unload", plist], { stdio: "ignore" });
        } catch {
          // Not loaded.
        }
        unlinkSync(plist);
      }
      if (remove) continue;
      writeFileSync(plist, launchdPlist(job, times[job], env));
      execFileSync("launchctl", ["load", "-w", plist]);
    }
  } else if (process.platform === "linux") {
    let existing = "";
    try {
      existing = execFileSync("crontab", ["-l"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      // No crontab yet.
    }
    execFileSync("crontab", ["-"], { input: mergeCrontab(existing, remove ? null : cronBlock(times, env)) });
  } else {
    throw new Error("Scheduling is set up for macOS and Linux. Windows comes with the installer (Phase 9).");
  }
  log(remove ? "Removed the prep and nag jobs." : `Scheduled /prep daily at ${times.prep} and /nag at ${times.nag}. Output goes to ${join(dir, "runs")}.`);
}
