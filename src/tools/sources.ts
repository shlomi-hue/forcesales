// Fetch a signal source's plain text by its source id, for quote.check.

import type { Calendar } from "./calendar.js";
import { eventText } from "./calendar.js";
import { driveText, type Drive } from "./drive.js";
import { threadText, type Gmail } from "./gmail.js";

export function sourceReader(clients: { gmail: () => Gmail; drive: () => Drive; calendar: () => Calendar }) {
  return async (source: string): Promise<string | null> => {
    const m = source.match(/^(gmail\/thread|drive\/file|calendar\/event)\/([\w-]+)$/);
    if (!m) return null;
    const [, kind, id = ""] = m;
    if (kind === "gmail/thread") return threadText(clients.gmail(), id);
    if (kind === "drive/file") return (await driveText(clients.drive(), id)).text;
    return eventText(clients.calendar(), id);
  };
}
