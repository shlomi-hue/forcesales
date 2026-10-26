import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { markdownToPdf, parseBlocks, textWidth, winAnsi, wrap } from "../../src/export/pdf.js";
import { memoryWrite } from "../../src/tools/memory.js";
import { exportPdf } from "../../src/tools/export.js";
import { tempDataDir } from "./fake-google.js";

const CARD = `# Battle card: Acme RFP vs Globex

**RFP:** Logistics 2026 · due 2026-11-15

## Requirement by requirement

| Section | Requirement | Us | Them | Verdict |
|---|---|---|---|---|
| 3.1 | SSO | SAML + OIDC | SAML only | win |
| 4.4 | On-prem | No | Yes | lose |

- Café, “quotes”, € and 中文
`;

// Every page's text, decompressed, for assertions.
function contents(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const out: string[] = [];
  for (const m of raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)) out.push(inflateSync(Buffer.from(m[1] ?? "", "latin1")).toString("latin1"));
  return out.join("\n");
}

describe("PDF export", () => {
  it("maps text to the built-in fonts' encoding", () => {
    expect(winAnsi("Café “x” – € → 中")).toBe("Caf\xe9 \x93x\x94 \x96 \x80 -> ?");
    expect(textWidth("Hello", 10, false)).toBeCloseTo(22.78, 1);
    expect(textWidth("Hello", 10, true)).toBeGreaterThan(textWidth("Hello", 10, false));
  });

  it("wraps on word boundaries and cuts words longer than a line", () => {
    const lines = wrap([{ text: "one two three four", bold: false }], 10, 50);
    expect(lines.map((l) => l.map((w) => w.text).join(""))).toEqual(["one two ", "three four"]);
    expect(wrap([{ text: "x".repeat(100), bold: false }], 10, 50).length).toBeGreaterThan(1);
  });

  it("reads headings, bullets with continuation lines, and tables", () => {
    const blocks = parseBlocks("# T\n- a\n  source: x\n\n| A | B |\n|---|---|\n| 1 | 2 |\n");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "T" },
      { kind: "bullet", level: 0, marker: "•", text: "a source: x" },
      { kind: "gap" },
      { kind: "table", rows: [["A", "B"], ["1", "2"]] },
    ]);
  });

  it("writes a valid PDF: header, objects at the offsets the xref gives, trailer", () => {
    const pdf = markdownToPdf(CARD, { title: "Acme vs Globex", footer: "Internal", date: new Date("2026-10-26T00:00:00Z") });
    const raw = pdf.toString("latin1");
    expect(raw.startsWith("%PDF-1.4")).toBe(true);
    expect(raw.trimEnd().endsWith("%%EOF")).toBe(true);
    const startxref = Number(raw.match(/startxref\n(\d+)/)?.[1]);
    expect(raw.slice(startxref, startxref + 4)).toBe("xref");
    const offsets = [...raw.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => expect(raw.slice(o, o + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`));
    const text = contents(pdf);
    expect(text).toContain("(Battle card: Acme RFP vs Globex) Tj");
    expect(text).toContain("(win) Tj");
    expect(text).toContain("0.85 0.94 0.85 rg");
    expect(text).toContain("0.98 0.86 0.86 rg");
    expect(text).toContain("(Page 1 of 1) Tj");
  });

  it("breaks long tables across pages and repeats the header", () => {
    const rows = Array.from({ length: 120 }, (_, i) => `| ${i} | a row of text |`).join("\n");
    const pdf = markdownToPdf(`| No | Text |\n|---|---|\n${rows}\n`, { title: "Long" });
    const pages = Number(pdf.toString("latin1").match(/\/Count (\d+)/)?.[1]);
    expect(pages).toBeGreaterThan(1);
    expect(contents(pdf).match(/\(No\) Tj/g)).toHaveLength(pages);
  });

  it("exports a memory file into <data>/exports", async () => {
    const dir = tempDataDir();
    await memoryWrite({ dir, sourceText: async () => null }, { path: "memory/deals/acme/rfp-globex.md", content: CARD, mode: "replace" });
    const out = await exportPdf(dir, { path: "memory/deals/acme/rfp-globex.md", footer: "Internal: do not share" });
    expect(out).toBe(`${dir}/exports/acme-rfp-globex.pdf`);
    expect(readFileSync(out).subarray(0, 8).toString()).toBe("%PDF-1.4");
    await expect(exportPdf(dir, { path: "../../etc/passwd" })).rejects.toThrow();
  });
});
