import type { sheets_v4 } from "@googleapis/sheets";
import { parseRateCard, type ColumnOverrides, type RateCard, type SheetTab } from "../checks/rate-card.js";

export type Sheets = Pick<sheets_v4.Sheets, "spreadsheets">;

const MAX_ROWS_PER_TAB = 2000;

// Read one range, or every tab when no range is given. Cells come back as formatted text.
export async function readTabs(sheets: Sheets, spreadsheetId: string, range?: string): Promise<SheetTab[]> {
  let ranges: string[];
  if (range) {
    ranges = [range];
  } else {
    const meta = await sheets.spreadsheets.get({ spreadsheetId, fields: "sheets.properties.title" });
    ranges = (meta.data.sheets ?? []).map((s) => quoteTab(s.properties?.title ?? "")).filter((t) => t !== "''");
  }
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges,
    valueRenderOption: "FORMATTED_VALUE",
    majorDimension: "ROWS",
  });
  return (res.data.valueRanges ?? []).map((vr, i) => ({
    title: tabTitle(vr.range ?? ranges[i] ?? ""),
    rows: (vr.values ?? []).slice(0, MAX_ROWS_PER_TAB).map((row) => row.map((c) => String(c ?? ""))),
  }));
}

export async function loadRateCard(
  sheets: Sheets,
  spreadsheetId: string,
  range?: string,
  columns?: ColumnOverrides,
): Promise<RateCard> {
  return parseRateCard(await readTabs(sheets, spreadsheetId, range), columns);
}

export function tabsAsText(tabs: SheetTab[]): string {
  return tabs
    .map((t) => `## ${t.title}\n${t.rows.map((r, i) => `${i + 1}\t${r.join("\t")}`).join("\n")}`)
    .join("\n\n");
}

const quoteTab = (title: string) => `'${title.replace(/'/g, "''")}'`;

function tabTitle(a1: string): string {
  const name = a1.includes("!") ? a1.slice(0, a1.lastIndexOf("!")) : a1;
  return name.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
}
