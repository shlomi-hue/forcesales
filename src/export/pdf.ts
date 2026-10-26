// Markdown to PDF with no dependencies: the standard Helvetica fonts, A4 pages.
// Handles what battle cards and briefs use: headings, paragraphs, **bold**, bullets,
// tables (wrapped cells, header repeated on each page, verdict cells shaded), rules.

import { deflateSync } from "node:zlib";
import { HELVETICA, HELVETICA_BOLD } from "./fonts.js";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;
const BODY_W = PAGE_W - 2 * MARGIN;
const FOOTER_Y = 28;

// ---------- text: Unicode to WinAnsi, and widths ----------

const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const SUBSTITUTE: Record<string, string> = { "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "✓": "Yes", "✔": "Yes", "✗": "No", "✘": "No", "≈": "~", "\t": "    " };

// Text as WinAnsi bytes held in a latin1 string. Characters the fonts lack become "?".
export function winAnsi(text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    const sub = SUBSTITUTE[ch];
    if (sub !== undefined) {
      out += sub;
      continue;
    }
    const cp = ch.codePointAt(0) ?? 63;
    if ((cp >= 0x20 && cp < 0x7f) || (cp >= 0xa0 && cp <= 0xff)) out += ch;
    else if (CP1252[cp] !== undefined) out += String.fromCharCode(CP1252[cp]);
    else if (cp === 0x0a) out += " ";
    else out += "?";
  }
  return out;
}

export function textWidth(ansi: string, size: number, bold: boolean): number {
  const table = bold ? HELVETICA_BOLD : HELVETICA;
  let w = 0;
  for (let i = 0; i < ansi.length; i++) w += table[ansi.charCodeAt(i) - 32] ?? 556;
  return (w * size) / 1000;
}

const pdfString = (ansi: string) => `(${ansi.replace(/[\\()]/g, (c) => `\\${c}`)})`;

// ---------- inline runs and wrapping ----------

interface Run {
  text: string;
  bold: boolean;
}

export function parseInline(md: string, bold = false): Run[] {
  const plain = md
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]+)\]\((\S+?)\)/g, "$1 ($2)")
    .replace(/(^|[^*])\*([^*\s][^*]*?)\*(?!\*)/g, "$1$2");
  const runs: Run[] = [];
  const parts = plain.split(/\*\*/);
  parts.forEach((p, i) => {
    if (p) runs.push({ text: winAnsi(p), bold: bold !== (i % 2 === 1) });
  });
  return runs;
}

type Word = Run & { width: number };
type Line = Word[];

export function wrap(runs: Run[], size: number, maxWidth: number): Line[] {
  const words: Word[] = [];
  for (const r of runs) {
    for (const piece of r.text.split(/(\s+)/)) {
      if (!piece) continue;
      if (/^\s+$/.test(piece)) {
        const last = words.at(-1);
        if (last) last.text += " ";
        continue;
      }
      words.push({ text: piece, bold: r.bold, width: 0 });
    }
  }
  const lines: Line[] = [];
  let line: Line = [];
  let lineW = 0;
  for (const w of words) {
    // A word wider than the line is cut into pieces that fit.
    let text = w.text;
    while (textWidth(text.trimEnd(), size, w.bold) > maxWidth) {
      let n = text.length - 1;
      while (n > 1 && textWidth(text.slice(0, n), size, w.bold) > maxWidth) n--;
      if (line.length) lines.push(line);
      lines.push([{ text: text.slice(0, n), bold: w.bold, width: textWidth(text.slice(0, n), size, w.bold) }]);
      line = [];
      lineW = 0;
      text = text.slice(n);
    }
    const width = textWidth(text, size, w.bold);
    const fit = textWidth(text.trimEnd(), size, w.bold);
    if (line.length && lineW + fit > maxWidth) {
      lines.push(line);
      line = [];
      lineW = 0;
    }
    line.push({ text, bold: w.bold, width });
    lineW += width;
  }
  if (line.length) lines.push(line);
  return lines.length ? lines : [[]];
}

// ---------- markdown blocks ----------

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "para"; text: string }
  | { kind: "bullet"; level: number; marker: string; text: string }
  | { kind: "table"; rows: string[][] }
  | { kind: "rule" }
  | { kind: "gap" };

const cellsOf = (line: string) =>
  line
    .trim()
    .replace(/^\||\|$/g, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, "|"));

export function parseBlocks(md: string): Block[] {
  const lines = md.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const h = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    const b = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ kind: "heading", level: (h[1] ?? "#").length, text: h[2] ?? "" });
    } else if (/^\s*\|/.test(line)) {
      flush();
      const rows: string[][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i] ?? "")) {
        const cells = cellsOf(lines[i] ?? "");
        if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
        i++;
      }
      i--;
      if (rows.length) blocks.push({ kind: "table", rows });
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      blocks.push({ kind: "rule" });
    } else if (b) {
      flush();
      const marker = /^\d/.test(b[2] ?? "") ? (b[2] ?? "") : "•";
      blocks.push({ kind: "bullet", level: Math.floor((b[1] ?? "").replace(/\t/g, "  ").length / 2), marker, text: b[3] ?? "" });
    } else if (/^\s+\S/.test(line) && blocks.at(-1)?.kind === "bullet" && para.length === 0) {
      // A continuation line under a bullet (like a signal's "source:" line).
      const last = blocks.at(-1) as Extract<Block, { kind: "bullet" }>;
      last.text += ` ${line.trim()}`;
    } else if (line.trim() === "") {
      flush();
      if (blocks.at(-1)?.kind !== "gap") blocks.push({ kind: "gap" });
    } else para.push(line.trim());
  }
  flush();
  while (blocks.at(-1)?.kind === "gap") blocks.pop();
  return blocks;
}

// ---------- layout ----------

const SHADE: Record<string, [number, number, number]> = {
  win: [0.85, 0.94, 0.85],
  "we win": [0.85, 0.94, 0.85],
  lose: [0.98, 0.86, 0.86],
  "they win": [0.98, 0.86, 0.86],
  tie: [0.98, 0.95, 0.82],
  unknown: [0.92, 0.92, 0.92],
};

class Pages {
  pages: string[][] = [];
  y = 0;
  private ops: string[] = [];

  constructor() {
    this.newPage();
  }

  newPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = PAGE_H - MARGIN;
  }

  need(h: number): void {
    if (this.y - h < MARGIN + 10) this.newPage();
  }

  text(x: number, y: number, size: number, bold: boolean, ansi: string, gray = 0.1): void {
    if (!ansi) return;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${gray} g 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ${pdfString(ansi)} Tj ET`);
  }

  // One text operation per stretch of same-font words, so the PDF's text reads naturally.
  line(x: number, y: number, words: Line, size: number, gray = 0.1): void {
    let cx = x;
    let i = 0;
    while (i < words.length) {
      const bold = words[i]?.bold ?? false;
      let text = "";
      let width = 0;
      while (i < words.length && words[i]?.bold === bold) {
        text += words[i]?.text ?? "";
        width += words[i]?.width ?? 0;
        i++;
      }
      this.text(cx, y, size, bold, text.trimEnd(), gray);
      cx += width;
    }
  }

  rect(x: number, y: number, w: number, h: number, rgb: [number, number, number]): void {
    this.ops.push(`${rgb.join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  stroke(x1: number, y1: number, x2: number, y2: number, gray = 0.75, width = 0.5): void {
    this.ops.push(`${gray} G ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  paragraph(runs: Run[], size: number, x = MARGIN, width = BODY_W, gap = 4): void {
    const lead = size * 1.35;
    for (const l of wrap(runs, size, width)) {
      this.need(lead);
      this.y -= lead;
      this.line(x, this.y + size * 0.3, l, size);
    }
    this.y -= gap;
  }
}

function layoutTable(p: Pages, rows: string[][]): void {
  const size = 8.5;
  const lead = size * 1.3;
  const pad = 4;
  const n = Math.max(...rows.map((r) => r.length));
  const cell = (r: string[], c: number, header: boolean) => parseInline(r[c] ?? "", header);
  const natural = Array.from({ length: n }, (_, c) => Math.max(...rows.map((r, i) => textWidth(winAnsi(r[c] ?? ""), size, i === 0) + 2 * pad)));
  const minW = Array.from({ length: n }, (_, c) =>
    Math.min(90, Math.max(30, ...rows.map((r, i) => Math.max(...(r[c] ?? "").split(/\s+/).map((w) => textWidth(winAnsi(w), size, i === 0) + 2 * pad + 1))))),
  );
  let widths = natural.map((w, c) => Math.max(minW[c] ?? 30, w));
  const total = widths.reduce((a, b) => a + b, 0);
  if (total > BODY_W) {
    // Shrink the wide columns first, never below each column's longest word.
    const fixed = widths.map((w, c) => Math.min(w, minW[c] ?? 30));
    const flex = widths.map((w, c) => w - (fixed[c] ?? 0));
    const room = BODY_W - fixed.reduce((a, b) => a + b, 0);
    const flexTotal = flex.reduce((a, b) => a + b, 0) || 1;
    widths = fixed.map((f, c) => f + Math.max(0, room) * ((flex[c] ?? 0) / flexTotal));
    const sum = widths.reduce((a, b) => a + b, 0);
    if (sum > BODY_W) widths = widths.map((w) => (w * BODY_W) / sum);
  }

  const drawRow = (r: string[], header: boolean) => {
    const wrapped = Array.from({ length: n }, (_, c) => wrap(cell(r, c, header), size, (widths[c] ?? 40) - 2 * pad));
    const h = Math.max(...wrapped.map((l) => l.length)) * lead + 2 * pad;
    return { wrapped, h };
  };
  const paint = (r: string[], header: boolean, wrapped: Line[][], h: number) => {
    let x = MARGIN;
    const top = p.y;
    for (let c = 0; c < n; c++) {
      const w = widths[c] ?? 40;
      const shade = header ? ([0.88, 0.9, 0.93] as [number, number, number]) : SHADE[(r[c] ?? "").trim().toLowerCase().replace(/\*/g, "")];
      if (shade) p.rect(x, top - h, w, h, shade);
      (wrapped[c] ?? []).forEach((l, i) => p.line(x + pad, top - pad - (i + 1) * lead + size * 0.3, l, size));
      x += w;
    }
    p.stroke(MARGIN, top - h, MARGIN + widths.reduce((a, b) => a + b, 0), top - h);
    p.y = top - h;
  };

  const head = rows[0] ?? [];
  const headRow = drawRow(head, true);
  p.need(headRow.h + lead * 2);
  paint(head, true, headRow.wrapped, headRow.h);
  for (const r of rows.slice(1)) {
    const row = drawRow(r, false);
    if (p.y - row.h < MARGIN + 10) {
      p.newPage();
      paint(head, true, headRow.wrapped, headRow.h);
    }
    paint(r, false, row.wrapped, row.h);
  }
  p.y -= 8;
}

export interface PdfOptions {
  title: string;
  // Shown at the bottom left of every page, e.g. "Internal: do not share".
  footer?: string;
  // Fixed creation time, for tests.
  date?: Date;
}

export function markdownToPdf(markdown: string, opts: PdfOptions): Buffer {
  const p = new Pages();
  const sizes: Record<number, number> = { 1: 19, 2: 13.5, 3: 11.5, 4: 10.5 };
  for (const b of parseBlocks(markdown)) {
    if (b.kind === "heading") {
      const size = sizes[b.level] ?? 10.5;
      const before = b.level === 1 ? 0 : size * 0.9;
      p.need(before + size * 3);
      p.y -= before;
      p.paragraph(parseInline(b.text, true), size, MARGIN, BODY_W, b.level <= 2 ? 6 : 3);
      if (b.level <= 2) {
        p.stroke(MARGIN, p.y + 3, MARGIN + BODY_W, p.y + 3, b.level === 1 ? 0.3 : 0.75, b.level === 1 ? 1 : 0.5);
        p.y -= 4;
      }
    } else if (b.kind === "para") {
      p.paragraph(parseInline(b.text), 10);
    } else if (b.kind === "bullet") {
      const indent = MARGIN + 12 + b.level * 14;
      const size = 10;
      const lines = wrap(parseInline(b.text), size, BODY_W - (indent - MARGIN) - 4);
      lines.forEach((l, i) => {
        p.need(size * 1.35);
        p.y -= size * 1.35;
        if (i === 0) p.text(indent - 10, p.y + size * 0.3, size, false, winAnsi(b.marker === "•" ? "•" : b.marker));
        p.line(indent + (b.marker === "•" ? 0 : 6), p.y + size * 0.3, l, size);
      });
      p.y -= 2;
    } else if (b.kind === "table") {
      layoutTable(p, b.rows);
    } else if (b.kind === "rule") {
      p.need(12);
      p.y -= 6;
      p.stroke(MARGIN, p.y, MARGIN + BODY_W, p.y);
      p.y -= 6;
    } else {
      p.y -= 4;
    }
  }

  const total = p.pages.length;
  const footer = winAnsi(opts.footer ?? opts.title);
  p.pages.forEach((ops, i) => {
    const label = winAnsi(`Page ${i + 1} of ${total}`);
    ops.push(`BT /F1 8 Tf 0.45 g 1 0 0 1 ${MARGIN} ${FOOTER_Y} Tm ${pdfString(footer)} Tj ET`);
    ops.push(`BT /F1 8 Tf 0.45 g 1 0 0 1 ${(PAGE_W - MARGIN - textWidth(label, 8, false)).toFixed(2)} ${FOOTER_Y} Tm ${pdfString(label)} Tj ET`);
  });
  return assemble(p.pages, opts);
}

// ---------- the PDF file ----------

function assemble(pages: string[][], opts: PdfOptions): Buffer {
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => {
    objects.push(typeof body === "string" ? Buffer.from(body, "latin1") : body);
    return objects.length;
  };
  const d = opts.date ?? new Date();
  const stamp = `D:${d.toISOString().replace(/[-:T]/g, "").slice(0, 14)}Z`;

  add("<< /Type /Catalog /Pages 2 0 R >>");
  add("PAGES");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  add(`<< /Title ${pdfString(winAnsi(opts.title))} /Producer (deal-harness) /CreationDate (${stamp}) >>`);
  const kids: number[] = [];
  for (const ops of pages) {
    const data = deflateSync(Buffer.from(ops.join("\n"), "latin1"));
    const content = add(Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]));
    kids.push(
      add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${content} 0 R >>`),
    );
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`, "latin1");

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = chunks[0]?.length ?? 0;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(offset);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(chunk);
    offset += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${offset}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}
