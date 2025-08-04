export function formatDutchDateTime(date) {
  if (!date) return "";
  const dt = typeof date === "string" ? new Date(date) : date;
  return dt.toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" });
}
