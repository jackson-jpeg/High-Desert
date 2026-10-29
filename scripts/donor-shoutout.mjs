#!/usr/bin/env node
/**
 * Thank the supporters in the phone lines (docs/live-chat.md, "Station
 * notices"; Jackson, 2026-10-29): a station notice naming everyone in
 * src/lib/support/supporters.ts, every 4 to 6 days at random, in the evening
 * Pacific when the room has people in it.
 *
 * highdesert-shoutout.timer runs this hourly. A run posts only when the gap
 * chosen at the last post has passed and it is 6 PM to 11 PM Pacific, then
 * picks the next gap (96 to 144 hours). `--now` posts at once (and starts a
 * new gap); `--dry-run` prints the text and what it would do; `--status`
 * prints, as JSON, the supporters, the last post and when the next is due
 * (sang3r.com's admin console reads it).
 *
 * State: $SHOUTOUT_STATE (default /var/lib/highdesert-shoutout/state.json).
 * Admin token: LIVE_ADMIN_TOKEN (/root/.high-desert-live.env).
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MIN_GAP_HOURS = 4 * 24;
export const MAX_GAP_HOURS = 6 * 24;
/** Pacific hours a shout-out may go out in: [from, to). */
export const EVENING = [18, 23];
const MAX_CHARS = 500;

/** The supporters, in the file's order: [{name, amount}]. */
export function parseSupporters(source) {
  const list = source.slice(source.indexOf("SUPPORTERS"));
  return [...list.matchAll(/\{\s*name:\s*"([^"]+)",\s*amount:\s*(\d+)\s*\}/g)].map((m) => ({ name: m[1], amount: Number(m[2]) }));
}

/** "A", "A and B", "A, B and C". */
export function listNames(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** End a sentence on the names, which end in an initial's period already ("Craig A."). */
const stop = (who) => (who.endsWith(".") ? who : `${who}.`);
const TEMPLATES = [
  (who) => `Thank you to the listeners who keep High Desert on the air: ${stop(who)} If you'd like to chip in too, the Venmo link is on the Stats page.`,
  (who) => `A word of thanks from the station to our supporters: ${stop(who)} You keep the lights on in the Kingdom of Nye. The Stats page has the link if you'd like to join them.`,
  (who) => `This station runs on its listeners. Thank you, ${stop(who)} The Venmo link is on the Stats page, with the supporters.`,
];
export const TEMPLATE_COUNT = TEMPLATES.length;

/** The notice: every supporter by name (newest first), in one of the phrasings. Null with nobody to thank. */
export function shoutoutText(supporters, which = 0) {
  if (supporters.length === 0) return null;
  const t = TEMPLATES[((which % TEMPLATES.length) + TEMPLATES.length) % TEMPLATES.length];
  const names = supporters.map((s) => s.name);
  for (let n = names.length; n >= 1; n--) {
    const shown = n === names.length ? names : [...names.slice(0, n), `${names.length - n} more`];
    const text = t(listNames(shown));
    if (text.length <= MAX_CHARS) return text;
  }
  return null;
}

/** The hour in Pacific time. */
export function pacificHour(nowMs) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", hourCycle: "h23" }).format(nowMs));
}

/** The next gap, in hours, from a random number in [0, 1). */
export function nextGapHours(r) {
  return Math.round(MIN_GAP_HOURS + r * (MAX_GAP_HOURS - MIN_GAP_HOURS));
}

/** Should this run post? `state` is {lastAt, gapHours} or null (never posted: due). */
export function due(state, nowMs) {
  const h = pacificHour(nowMs);
  if (h < EVENING[0] || h >= EVENING[1]) return false;
  if (!state?.lastAt) return true;
  return nowMs >= Date.parse(state.lastAt) + (state.gapHours ?? MIN_GAP_HOURS) * 3_600_000;
}

/**
 * What the admin console shows: everyone thanked, the last shout-out, and
 * when the next one may go (`dueFrom`; it then waits for the evening window).
 */
export function shoutoutStatus(state, supporters, nowMs) {
  const lastAt = state?.lastAt ?? null;
  const gapHours = state?.gapHours ?? null;
  return {
    supporters,
    last: lastAt ? { at: lastAt, text: state.text ?? null } : null,
    gapHours,
    dueFrom: lastAt ? new Date(Date.parse(lastAt) + (gapHours ?? MIN_GAP_HOURS) * 3_600_000).toISOString() : null,
    due: due(state, nowMs),
    evening: { from: EVENING[0], to: EVENING[1], tz: "America/Los_Angeles" },
    preview: shoutoutText(supporters, ((state?.template ?? -1) + 1) % TEMPLATE_COUNT),
  };
}

async function readState(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function post(text, { url, token }) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, origin: "https://highdesert.space" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`notice refused: ${res.status} ${await res.text()}`);
  return res.json().catch(() => ({}));
}

async function main(argv) {
  const now = argv.includes("--now");
  const dry = argv.includes("--dry-run");
  const stateFile = process.env.SHOUTOUT_STATE ?? "/var/lib/highdesert-shoutout/state.json";
  const url = process.env.LIVE_NOTICE_URL ?? "http://127.0.0.1:3005/live-api/admin/notice";
  const state = await readState(stateFile);
  const nowMs = Date.now();
  if (argv.includes("--status")) {
    const supporters = parseSupporters(await readFile(path.join(ROOT, "src/lib/support/supporters.ts"), "utf8"));
    console.log(JSON.stringify(shoutoutStatus(state, supporters, nowMs)));
    return;
  }
  if (!now && !due(state, nowMs)) {
    console.log(`[shoutout] not due (last ${state?.lastAt ?? "never"}, gap ${state?.gapHours ?? "-"} h, Pacific hour ${pacificHour(nowMs)})`);
    return;
  }
  const supporters = parseSupporters(await readFile(path.join(ROOT, "src/lib/support/supporters.ts"), "utf8"));
  // Not the phrasing used last time.
  const which = ((state?.template ?? -1) + 1 + Math.floor(Math.random() * (TEMPLATE_COUNT - 1))) % TEMPLATE_COUNT;
  const text = shoutoutText(supporters, which);
  if (!text) {
    console.log("[shoutout] nobody to thank");
    return;
  }
  const gapHours = nextGapHours(Math.random());
  if (dry) {
    console.log(`[shoutout] would post: ${text}\n[shoutout] next in ${gapHours} h`);
    return;
  }
  const token = process.env.LIVE_ADMIN_TOKEN;
  if (!token) throw new Error("LIVE_ADMIN_TOKEN is not set");
  await post(text, { url, token });
  await mkdir(path.dirname(stateFile), { recursive: true });
  const next = { lastAt: new Date(nowMs).toISOString(), gapHours, template: which, text };
  await writeFile(`${stateFile}.tmp`, JSON.stringify(next, null, 2));
  await rename(`${stateFile}.tmp`, stateFile);
  console.log(`[shoutout] posted: ${text}\n[shoutout] next in ${gapHours} h`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[shoutout] ${err.message}`);
    process.exit(1);
  });
}
