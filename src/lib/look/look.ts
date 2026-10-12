/**
 * The site's looks: the public one and two previews (docs/looks.md).
 *
 *   default  what every visitor sees. Untouched by anything in this module.
 *   clean    the current dark theme, refined. Preview only.
 *   win98    the current layout in authentic gray Windows 98. Preview only.
 *
 * Only the owner can turn a preview on, and the chain is:
 *
 *   1. The phone lines' admin (`/live-api/admin/look`, services/live) sets
 *      `hd_look`: `v1.<look>.<exp>.<hmac>`, HttpOnly, signed under a key
 *      derived from LIVE_ADMIN_TOKEN. The app holds only that derived key
 *      (`HD_LOOK_KEY`), so it can check a preview but not mint an admin.
 *   2. `src/proxy.ts`, on every page request, verifies `hd_look`. Valid: it
 *      sets `hd_look_view=<look>` (readable by script). Anything else: it
 *      deletes `hd_look_view`, so a hand-written one lasts no further than
 *      the next page load (Set-Cookie on a document applies before its scripts).
 *   3. The boot script (src/app/boot-script.ts) copies `hd_look_view` onto
 *      `<html data-look>` before first paint; CSS keys on that, and
 *      `useLook()` reads it after hydration.
 *
 * Pages stay static: nothing here reads a cookie during rendering.
 */

export const LOOKS = ["default", "clean", "win98"] as const;
export type Look = (typeof LOOKS)[number];
export type PreviewLook = Exclude<Look, "default">;
export const PREVIEW_LOOKS: readonly PreviewLook[] = ["clean", "win98"];

/** The signed, HttpOnly credential (set by services/live). */
export const LOOK_COOKIE = "hd_look";
/** The script-readable copy the proxy keeps in step with LOOK_COOKIE. */
export const LOOK_VIEW_COOKIE = "hd_look_view";

export const LOOK_LABELS: Record<Look, string> = {
  default: "Public (today)",
  clean: "Clean",
  win98: "Win98",
};

export function isPreviewLook(v: unknown): v is PreviewLook {
  return v === "clean" || v === "win98";
}

const VALUE = /^v1\.(clean|win98)\.(\d{10,16})\.([0-9a-f]{64})$/;

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function hmacHex(keyHex: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(keyHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** What the signature covers. services/live/lib/look.mjs signs the same string. */
export const signedPart = (look: PreviewLook, exp: number) => `look:${look}:${exp}`;

/** A cookie value, for tests and tooling; production values come from services/live. */
export async function signLook(look: PreviewLook, exp: number, keyHex: string): Promise<string> {
  return `v1.${look}.${exp}.${await hmacHex(keyHex, signedPart(look, exp))}`;
}

/**
 * The preview a `hd_look` value grants, or null. Null for anything unsigned,
 * expired, malformed, or when no key is configured: no key, no previews.
 */
export async function verifyLook(
  value: string | undefined,
  keyHex: string | undefined,
  now = Date.now(),
): Promise<PreviewLook | null> {
  if (!value || !keyHex || !/^[0-9a-f]{64}$/.test(keyHex)) return null;
  const m = VALUE.exec(value);
  if (!m) return null;
  const look = m[1] as PreviewLook;
  const exp = Number(m[2]);
  if (!(exp > now)) return null;
  const expected = await hmacHex(keyHex, signedPart(look, exp));
  // Constant-time compare over equal-length hex.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ m[3].charCodeAt(i);
  return diff === 0 ? look : null;
}

/** The look a `document.cookie` string asks for (the view cookie only). */
export function lookFromCookieString(cookies: string): Look {
  for (const part of cookies.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === LOOK_VIEW_COOKIE && isPreviewLook(v)) return v;
  }
  return "default";
}
