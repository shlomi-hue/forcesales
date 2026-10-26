// Today's date where the user is (YYYY-MM-DD). Not UTC: at 7am in Singapore, UTC is still yesterday.
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
