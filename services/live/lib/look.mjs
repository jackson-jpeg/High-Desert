/**
 * The owner's preview looks (src/lib/look/look.ts, docs/looks.md).
 *
 * An admin (cookie or bearer, admin.mjs) POSTs /live-api/admin/look and gets
 * `hd_look`: `v1.<look>.<exp>.<hmac>`, Path=/, HttpOnly. The HMAC key is
 * derived from LIVE_ADMIN_TOKEN, and the web app holds only the derived key
 * (`HD_LOOK_KEY`, printed by `node services/live/lib/look.mjs --key` with the
 * token in the environment): it can verify a look but never mint an admin.
 */

import { createHmac } from "node:crypto";

export const LOOK_COOKIE = "hd_look";
export const LOOK_SESSION_MS = 30 * 24 * 60 * 60_000;
export const PREVIEW_LOOKS = ["clean", "win98"];

/** The derived key, as hex: what `HD_LOOK_KEY` holds in the app's env file. */
export function lookKeyHex(token) {
  return createHmac("sha256", token).update("highdesert look preview v1").digest("hex");
}

export function lookValue(token, look, now = Date.now()) {
  const exp = now + LOOK_SESSION_MS;
  const sig = createHmac("sha256", Buffer.from(lookKeyHex(token), "hex")).update(`look:${look}:${exp}`).digest("hex");
  return `v1.${look}.${exp}.${sig}`;
}

/** Set-Cookie for a look, or the clearing one for "default". */
export function lookCookie(token, look, now = Date.now()) {
  if (!PREVIEW_LOOKS.includes(look)) {
    return `${LOOK_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
  }
  return `${LOOK_COOKIE}=${lookValue(token, look, now)}; Path=/; Max-Age=${Math.floor(LOOK_SESSION_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`;
}

if (process.argv[1]?.endsWith("look.mjs") && process.argv.includes("--key")) {
  const token = process.env.LIVE_ADMIN_TOKEN;
  if (!token) {
    console.error("LIVE_ADMIN_TOKEN is not set");
    process.exit(1);
  }
  console.log(lookKeyHex(token));
}
