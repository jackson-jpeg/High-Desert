import type { Page } from "@playwright/test";

/**
 * A page's OWN live state, read from its own heartbeats, never from the
 * site-wide count.
 *
 * `/api/stats/now`'s `live` is distinct clients, and every browser a test run
 * opens on one machine is the same client. So "the count went up by one" was
 * true only when no other worker was tuned in at that moment: under CI's two
 * workers, "join, refresh, resume" in live-qa.spec.ts saw 1 where it expected
 * 2. What this page told the server, and whether the server took it, is this
 * page's alone. Held to its rules by scripts/__tests__/e2e-own-presence.test.ts.
 */

/** A heartbeat this page sent, and the server's answer. */
export type Beat = { sessionId: string; live: unknown; status: number };

/**
 * The live state the server was last told by this page: the newest beat the
 * server ACCEPTED decides (a refused one changed nothing there). `live` counts
 * only as the literal `true`, the server's own rule; its absence clears the
 * mark. `after` ignores beats before that index (a reload's fresh session).
 */
export function ownLiveState(beats: readonly Beat[], after = 0): "live" | "not-live" | "unknown" {
  const accepted = beats.slice(after).filter((b) => b.status >= 200 && b.status < 300);
  if (accepted.length === 0) return "unknown";
  return accepted[accepted.length - 1].live === true ? "live" : "not-live";
}

/** Record every heartbeat this page sends from now on, across reloads. */
export function recordBeats(page: Page): Beat[] {
  const beats: Beat[] = [];
  page.on("response", (res) => {
    const req = res.request();
    if (req.method() !== "POST" || !/\/api\/stats\/heartbeat(\?|$)/.test(req.url())) return;
    let body: { sessionId?: unknown; live?: unknown } = {};
    try {
      body = JSON.parse(req.postData() ?? "{}");
    } catch {
      // Not JSON: recorded with no session and no live flag.
    }
    beats.push({ sessionId: String(body.sessionId ?? ""), live: body.live, status: res.status() });
  });
  return beats;
}
