/**
 * Admin credential. Server-checked, and unrelated to the app's client-side
 * admin hash (useAdminStore), which is presentation and protects nothing.
 *
 *   - LIVE_ADMIN_TOKEN (32 random bytes, hex) lives in the chmod-600 env file
 *     and nowhere else. It is never put in a link and never sent to a browser.
 *   - A browser proves itself with the cookie `hd_live_admin`: an expiry and an
 *     HMAC of it under a key derived from the token. HttpOnly, Secure,
 *     SameSite=Strict, Path=/live-api. Rotating the token signs every session out.
 *   - The cookie is obtained once, by spending a one-time nonce from the sign-in
 *     link that scripts/live-setup.sh writes to the MacBook's ~/Downloads. The
 *     database holds only the nonce's SHA-256, with a 24-hour expiry, and
 *     `consumeNonce` succeeds exactly once.
 *   - A command line can use `Authorization: Bearer <LIVE_ADMIN_TOKEN>` directly.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ADMIN_COOKIE, ADMIN_SESSION_MS } from "./config.mjs";

export const sha256hex = (s) => createHash("sha256").update(String(s)).digest("hex");

function sessionKey(token) {
  return createHmac("sha256", token).update("highdesert-live admin session v1").digest();
}

function sign(token, exp) {
  return createHmac("sha256", sessionKey(token)).update(`admin:${exp}`).digest("hex");
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

/** The cookie value for a session that ends `ADMIN_SESSION_MS` from `now`. */
export function sessionValue(token, now = Date.now()) {
  const exp = now + ADMIN_SESSION_MS;
  return `v1.${exp}.${sign(token, exp)}`;
}

export function verifySession(value, token, now = Date.now()) {
  if (!token || typeof value !== "string") return false;
  const m = /^v1\.(\d{10,16})\.([0-9a-f]{64})$/.exec(value);
  if (!m) return false;
  const exp = Number(m[1]);
  if (!(exp > now)) return false;
  return safeEqual(m[2], sign(token, exp));
}

export function sessionCookie(token, now = Date.now()) {
  return `${ADMIN_COOKIE}=${sessionValue(token, now)}; Path=/live-api; Max-Age=${Math.floor(ADMIN_SESSION_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearedCookie = `${ADMIN_COOKIE}=; Path=/live-api; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

export function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/** Is this request an admin's? Cookie session, or the raw token as a bearer. */
export function isAdminRequest(req, token, now = Date.now()) {
  if (!token) return false;
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return safeEqual(auth.slice(7).trim(), token);
  }
  return verifySession(parseCookies(req.headers.cookie)[ADMIN_COOKIE], token, now);
}
