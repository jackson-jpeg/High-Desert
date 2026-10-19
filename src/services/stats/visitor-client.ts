/**
 * The visitor count, browser side (docs/visitors.md).
 *
 * A browser keeps one random id in localStorage (`hd-visitor`) and posts it
 * once per page load to /api/stats/visitor, with its device and look and,
 * once the funnel has a verdict for it, its own funnel arrival: that is what
 * lets the server match it to one of the funnel's backfilled arrivals instead
 * of counting it twice. The id is random, unrelated to the address, to the
 * presence session and to the phone lines' caller; clearing site data makes a
 * new one, which is the same limit every browser-side count has.
 *
 * The id is written *before* anything is posted, and nothing is posted when it
 * cannot be written: a browser that cannot remember its id would otherwise be
 * a new visitor on every load. A headless checker (./not-counted.ts) posts
 * nothing.
 */

import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";
import { pageLook } from "@/lib/look/choice";
import { currentDevice, funnelArrival } from "./funnel-client";
import { notCounted } from "./not-counted";

export const VISITOR_STORAGE_KEY = "hd-visitor";
/** How long to wait for the funnel's verdict before posting without it (show pages never give one). */
export const FUNNEL_WAIT_MS = 8_000;
const POLL_MS = 500;

const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

function mint(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** This browser's id, minted and remembered on first use; null when it cannot be remembered. */
export function visitorId(): string | null {
  const have = safeGetItem("local", VISITOR_STORAGE_KEY);
  if (have && ID_RE.test(have) && !have.startsWith("funnel-")) return have;
  const id = mint();
  if (!safeSetItem("local", VISITOR_STORAGE_KEY, id)) return null;
  return safeGetItem("local", VISITOR_STORAGE_KEY) === id ? id : null;
}

let sentThisLoad = false;

function post(id: string): void {
  const arrival = funnelArrival();
  const look = pageLook();
  const body: Record<string, unknown> = { visitorId: id, device: currentDevice() };
  if (look) body.look = look;
  if (arrival && "cohort" in arrival) {
    body.cohort = arrival.cohort;
    body.cohortDevice = arrival.device;
    if (arrival.look) body.cohortLook = arrival.look;
  } else if (arrival) {
    body.hereBefore = true;
  }
  void fetch("/api/stats/visitor", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {});
}

/**
 * Once per page load: post this browser's visit, after the funnel's verdict
 * (or FUNNEL_WAIT_MS without one). Returns a cancel for the wait.
 */
export function noteVisitor(): () => void {
  if (sentThisLoad || notCounted()) return () => {};
  const id = visitorId();
  if (!id) return () => {};
  sentThisLoad = true;
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const tick = () => {
    timer = null;
    if (funnelArrival() !== null || Date.now() - started >= FUNNEL_WAIT_MS) {
      post(id);
      return;
    }
    timer = setTimeout(tick, POLL_MS);
  };
  tick();
  return () => {
    // An unmount mid-wait (a navigation) still owes this load its post.
    if (timer !== null) {
      clearTimeout(timer);
      post(id);
    }
  };
}

export function resetVisitorForTests(): void {
  sentThisLoad = false;
}
