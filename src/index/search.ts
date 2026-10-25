// index.sqlite: full-text search over the markdown in the data folder, one row per section.
// It's a cache: `reindex` rebuilds it from the markdown at any time. Vectors come later.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import Database from "better-sqlite3";

type DB = Database.Database;

export interface Hit {
  path: string;
  heading: string;
  snippet: string;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, mtime REAL NOT NULL);
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(path UNINDEXED, heading, body, tokenize = 'porter unicode61');
`;

export function openIndex(dir: string): DB {
  const db = new Database(join(dir, "index.sqlite"));
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  return db;
}

// Split a markdown file into sections at "#" and "##" headings.
export function chunk(markdown: string): { heading: string; body: string }[] {
  const out: { heading: string; body: string }[] = [];
  let heading = "";
  let body: string[] = [];
  const flush = () => {
    const text = body.join("\n").trim();
    if (text || heading) out.push({ heading, body: text });
  };
  for (const line of markdown.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const m = line.match(/^#{1,2}\s+(.+)$/);
    if (m) {
      flush();
      heading = m[1]?.trim() ?? "";
      body = [];
    } else body.push(line);
  }
  flush();
  return out;
}

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith(".")) continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(".md")) out.push(relative(dir, p).split(sep).join("/"));
    }
  };
  for (const top of ["memory", "company"]) if (existsSync(join(dir, top))) walk(join(dir, top));
  return out.sort();
}

export function indexFile(db: DB, dir: string, rel: string): void {
  const abs = join(dir, rel);
  const tx = db.transaction(() => {
    db.prepare("DELETE FROM chunks WHERE path = ?").run(rel);
    db.prepare("DELETE FROM files WHERE path = ?").run(rel);
    if (!existsSync(abs)) return;
    const insert = db.prepare("INSERT INTO chunks (path, heading, body) VALUES (?, ?, ?)");
    for (const c of chunk(readFileSync(abs, "utf8"))) insert.run(rel, c.heading, c.body);
    db.prepare("INSERT INTO files (path, mtime) VALUES (?, ?)").run(rel, statSync(abs).mtimeMs);
  });
  tx();
}

// Throw everything away and rebuild from the markdown.
export function reindex(dir: string): { files: number; chunks: number } {
  const db = openIndex(dir);
  try {
    db.exec("DELETE FROM chunks; DELETE FROM files;");
    const files = markdownFiles(dir);
    for (const f of files) indexFile(db, dir, f);
    const { n } = db.prepare("SELECT count(*) AS n FROM chunks").get() as { n: number };
    return { files: files.length, chunks: n };
  } finally {
    db.close();
  }
}

// Bring changed files up to date (edits made by hand outside the harness), then search.
export function search(dir: string, query: string, limit = 10): Hit[] {
  const db = openIndex(dir);
  try {
    const known = new Map((db.prepare("SELECT path, mtime FROM files").all() as { path: string; mtime: number }[]).map((r) => [r.path, r.mtime]));
    const now = markdownFiles(dir);
    for (const f of now) if (known.get(f) !== statSync(join(dir, f)).mtimeMs) indexFile(db, dir, f);
    for (const f of known.keys()) if (!now.includes(f)) indexFile(db, dir, f);

    const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
    if (terms.length === 0) return [];
    const match = terms.map((t) => `"${t}"`).join(" ");
    return db
      .prepare(
        `SELECT path, heading, snippet(chunks, 2, '[', ']', ' … ', 16) AS snippet
         FROM chunks WHERE chunks MATCH ? ORDER BY bm25(chunks, 0, 2, 1) LIMIT ?`,
      )
      .all(match, limit) as Hit[];
  } finally {
    db.close();
  }
}
