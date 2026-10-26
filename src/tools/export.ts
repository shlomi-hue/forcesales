// Turn a markdown file from the data folder into a PDF in <data>/exports/ (not committed).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { ensureDataFolder, safePath } from "../data/folder.js";
import { markdownToPdf } from "../export/pdf.js";

export async function exportPdf(dir: string, input: { path: string; name?: string; footer?: string }): Promise<string> {
  await ensureDataFolder(dir);
  const { abs, rel } = safePath(dir, input.path);
  if (!rel.endsWith(".md")) throw new Error("Give a markdown file from the data folder, like memory/deals/acme/rfp-globex.md.");
  if (!existsSync(abs)) throw new Error(`${rel} doesn't exist.`);
  const md = readFileSync(abs, "utf8");
  const title = md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? basename(rel, ".md");
  const name = (input.name ?? rel.replace(/^memory\/(deals\/)?/, "").replace(/\.md$/, ""))
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const out = join(dir, "exports", `${name || "export"}.pdf`);
  mkdirSync(join(dir, "exports"), { recursive: true });
  writeFileSync(out, markdownToPdf(md, { title, footer: input.footer ?? title }));
  return out;
}
