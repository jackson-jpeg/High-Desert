/**
 * Time heard, for people: "45m" under an hour, "3.5h" from there. "0.0h" read
 * as broken for a listener who had heard twenty minutes (UI plan push 6).
 */
export function formatHeard(seconds: number): string {
  const s = Math.max(0, seconds);
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
