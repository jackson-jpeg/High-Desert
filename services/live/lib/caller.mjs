/**
 * Caller identity: one browser, one caller.
 *
 *   - The cookie `hd_live_caller` holds `v1.<id>.<sig>`: 32 random bytes
 *     (base64url) and an HMAC of them under a key derived from
 *     CHAT_CLIENT_SECRET. HttpOnly, Secure, SameSite=Lax, Path=/live-api,
 *     400 days. It carries nothing about the person; it is a random number.
 *   - Only ids this service minted verify, so a caller cannot invent a fresh
 *     id to step around the address limits: a new id comes from the service,
 *     through the per-address mint cap, or not at all.
 *   - The database never sees the cookie. A caller is `client_ref`, an HMAC of
 *     the id, so a copy of the tables cannot be replayed as anyone's cookie.
 *   - The address is `addr_ref`: HMAC of the app's own bucket (IPv4 address,
 *     IPv6 /64, src/lib/utils/client-key.ts). The same function keyed every
 *     caller before 2026-09-26, so an address-keyed row is a legacy caller,
 *     and `adoptLegacy` hands it to the first browser that arrives from there.
 *     Distinct inputs ("caller:" prefix) mean the two kinds can never collide.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hashClientKey, clientKey } from "./shared/client-key.ts";
import { CALLER_COOKIE, CALLER_COOKIE_MAX_AGE_S } from "./config.mjs";

function cookieKey(secret) {
  return createHmac("sha256", secret).update("highdesert-live caller cookie v1").digest();
}

function sign(secret, id) {
  return createHmac("sha256", cookieKey(secret)).update(`caller:${id}`).digest("base64url");
}

/** A fresh caller id: 32 random bytes, base64url (43 characters). */
export function mintCallerId() {
  return randomBytes(32).toString("base64url");
}

export function callerCookieValue(secret, id) {
  return `v1.${id}.${sign(secret, id)}`;
}

/** The id inside a cookie value, if this service minted it; otherwise null. */
export function verifyCallerCookie(value, secret) {
  if (typeof value !== "string") return null;
  const m = /^v1\.([A-Za-z0-9_-]{43})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m) return null;
  const want = Buffer.from(sign(secret, m[1]));
  const got = Buffer.from(m[2]);
  return want.length === got.length && timingSafeEqual(want, got) ? m[1] : null;
}

export function callerCookie(secret, id, { secure = true } = {}) {
  return `${CALLER_COOKIE}=${callerCookieValue(secret, id)}; Path=/live-api; Max-Age=${CALLER_COOKIE_MAX_AGE_S}; HttpOnly;${secure ? " Secure;" : ""} SameSite=Lax`;
}

/** client_ref: who is calling. 64 hex characters, like every ref column. */
export function callerRef(id, secret) {
  return hashClientKey(`caller:${id}`, secret);
}

/** addr_ref: where from. The same HMAC that keyed callers before per-browser ids. */
export function addressRef(address, secret) {
  return hashClientKey(clientKey(address), secret);
}
