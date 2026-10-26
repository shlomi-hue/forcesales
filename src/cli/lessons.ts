// `deal-harness lessons`: the user accepts or rejects proposed lessons in the terminal.
// Accepting is the only way a lesson reaches accepted.md or the playbook: the agent has no tool for it.
// `deal-harness learn`: capture sent drafts and propose lessons, without an agent.

import { gmail } from "@googleapis/gmail";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { localToday } from "../dates.js";
import { commit, dataDir, ensureDataFolder } from "../data/folder.js";
import { loadConfig } from "../data/settings.js";
import { authorizedClient } from "../google/auth.js";
import { keychainStore } from "../google/token-store.js";
import { acceptedLine, parseLessons, removeLesson, setStatus, ACCEPTED, PLAYBOOK, PROPOSED, type Lesson } from "../memory/lessons.js";
import { captureSent, formatCapture, learnLessons } from "../tools/learn.js";

export interface LessonFiles {
  proposed: string;
  accepted: string;
  playbook: string;
}

// a accepts (voice → accepted.md, play → playbook), r rejects for good, anything else changes nothing.
export function applyLessonAnswer(files: LessonFiles, l: Lesson, answer: string, today: string): LessonFiles {
  const append = (md: string, line: string) => `${md.replace(/\n*$/, "\n")}\n${line}\n`;
  if (answer === "r") return { ...files, proposed: setStatus(files.proposed, l, "rejected") };
  if (answer !== "a") return files;
  const line = acceptedLine(l, today);
  return {
    proposed: removeLesson(files.proposed, l),
    accepted: l.kind === "voice" ? append(files.accepted, line) : files.accepted,
    playbook: l.kind === "play" ? append(files.playbook, line) : files.playbook,
  };
}

export async function reviewLessons(log: (s: string) => void): Promise<void> {
  const dir = dataDir();
  await ensureDataFolder(dir);
  const path = (rel: string) => join(dir, rel);
  const read = (rel: string) => (existsSync(path(rel)) ? readFileSync(path(rel), "utf8") : "");
  let files: LessonFiles = { proposed: read(PROPOSED), accepted: read(ACCEPTED), playbook: read(PLAYBOOK) };
  const pending = parseLessons(files.proposed).filter((l) => l.status === "proposed");
  if (pending.length === 0) return log("No lessons waiting. The agent proposes them with lessons_learn (in /company).");

  const rl = createInterface({ input: process.stdin, terminal: process.stdin.isTTY === true });
  const answers = rl[Symbol.asyncIterator]();
  log(`${pending.length} lesson(s) to review. a = accept, r = reject (never proposed again), s = skip, q = stop.\n`);
  let accepted = 0;
  let rejected = 0;
  try {
    for (const l of pending) {
      log(`[${l.kind}] ${l.rule}\n  why: ${l.why}`);
      process.stderr.write("  [a/r/s/q] ");
      const reply = await answers.next();
      if (reply.done) break;
      const a = String(reply.value).trim().toLowerCase();
      if (a === "q") break;
      if (a === "a") accepted++;
      if (a === "r") rejected++;
      files = applyLessonAnswer(files, l, a, localToday());
    }
  } finally {
    rl.close();
  }
  if (!accepted && !rejected) return log("Nothing changed.");
  writeFileSync(path(PROPOSED), files.proposed);
  writeFileSync(path(ACCEPTED), files.accepted);
  writeFileSync(path(PLAYBOOK), files.playbook);
  await commit(dir, [PROPOSED, ACCEPTED, PLAYBOOK], `Lessons: ${accepted} accepted, ${rejected} rejected`);
  log(`Saved: ${accepted} accepted, ${rejected} rejected. Accepted "Never write" lessons now block those words in drafts.`);
}

export async function learnNow(log: (s: string) => void): Promise<void> {
  const dir = dataDir();
  await ensureDataFolder(dir);
  const g = gmail({ version: "v1", auth: authorizedClient(loadConfig(dir).oauthClientPath, keychainStore()) });
  // Edits and lessons never carry signals, so no source is ever read.
  const memory = { dir, sourceText: async () => null };
  log(formatCapture(await captureSent(g, memory)));
  log(await learnLessons(memory));
  log("Review proposed lessons with `deal-harness lessons`.");
}
