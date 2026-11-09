import type { SponsorId } from "@/lib/support/sponsors";
import { notCounted } from "@/services/stats/not-counted";

/**
 * Station-sponsor impressions and clicks, from the browser
 * (docs/station-breaks.md). `heard` and `seen` count once per page per `key`
 * (a break's id, or the /stats visit); a click counts each time. Nothing
 * from a not-counted browser (csp-check, the returning-visitor check).
 */
export type SponsorSurface = "air" | "chat" | "stats";
export type SponsorEvent = "heard" | "seen" | "click" | "mute";

const sent = new Set<string>();

export function noteSponsor(app: SponsorId, surface: SponsorSurface, event: SponsorEvent, key = ""): void {
  if (typeof window === "undefined" || notCounted()) return;
  if (event !== "click") {
    const k = `${app}:${surface}:${event}:${key}`;
    if (sent.has(k)) return;
    sent.add(k);
  }
  const body = JSON.stringify({ app, surface, event });
  try {
    // keepalive: a click opens the App Store in a new tab, and this page may be left.
    void fetch("/api/stats/sponsor", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    // Counting is best effort.
  }
}

/** Tests only. */
export function resetSponsorNotesForTests(): void {
  sent.clear();
}
