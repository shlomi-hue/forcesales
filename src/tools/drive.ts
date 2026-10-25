import type { drive_v3 } from "@googleapis/drive";
import { dataBlock } from "../server/data-block.js";

export type Drive = Pick<drive_v3.Drive, "files">;

const MAX_CHARS = 50_000;

const EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document": "text/plain",
  "application/vnd.google-apps.presentation": "text/plain",
  "application/vnd.google-apps.spreadsheet": "text/csv",
};

export function driveId(value: string): string {
  return value.match(/\/d\/([\w-]{10,})/)?.[1] ?? value.match(/[?&]id=([\w-]{10,})/)?.[1] ?? value.trim();
}

export async function searchDrive(drive: Drive, query: string, max: number): Promise<string> {
  const q = `fullText contains '${query.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}' and trashed = false`;
  const res = await drive.files.list({ q, pageSize: max, fields: "files(id,name,mimeType,modifiedTime,owners(emailAddress))", orderBy: "modifiedTime desc" });
  const files = res.data.files ?? [];
  if (files.length === 0) return `No Drive files match: ${query}`;
  const rows = files.map((f) => `file_id: ${f.id}\nname: ${f.name}\ntype: ${f.mimeType}\nmodified: ${f.modifiedTime}\nowner: ${f.owners?.[0]?.emailAddress ?? ""}`);
  return dataBlock("drive/search", rows.join("\n\n"));
}

// Plain text of a file: Docs and Slides as text, Sheets as CSV, text files as they are.
export async function driveText(drive: Drive, fileId: string): Promise<{ name: string; text: string }> {
  const meta = await drive.files.get({ fileId, fields: "id,name,mimeType,size" });
  const mime = meta.data.mimeType ?? "";
  const name = meta.data.name ?? fileId;
  const exportAs = EXPORTS[mime];
  let text: string;
  if (exportAs) {
    const res = await drive.files.export({ fileId, mimeType: exportAs }, { responseType: "text" });
    text = String(res.data ?? "");
  } else if (/^text\/|json|markdown|csv|xml/.test(mime)) {
    const res = await drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
    text = String(res.data ?? "");
  } else {
    throw new Error(`${name} is a ${mime} file; v1 reads Google Docs, Slides, Sheets and text files only.`);
  }
  return { name, text: text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n[... cut at ${MAX_CHARS} characters]` : text };
}

export async function readDriveFile(drive: Drive, fileId: string): Promise<string> {
  const { name, text } = await driveText(drive, fileId);
  return dataBlock(`drive/file/${fileId}`, `file_id: ${fileId}\nname: ${name}\n\n${text}`);
}
