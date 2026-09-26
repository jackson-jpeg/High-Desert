/**
 * The page the one-time sign-in link opens:
 *   https://highdesert.space/live-api/admin/signin-page#<nonce>
 *
 * The nonce is in the fragment, so it never reaches a server log, a proxy or
 * a Referer. The page removes it from the address bar first, then POSTs it and
 * receives the HttpOnly session cookie. Its CSP allows exactly this one inline
 * script, by hash.
 */

import { createHash } from "node:crypto";

const SCRIPT = `
(async () => {
  const out = document.getElementById("out");
  const nonce = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  if (!/^[0-9a-f]{64}$/.test(nonce)) { out.textContent = "This link is incomplete. Open it exactly as written."; return; }
  try {
    const r = await fetch("/live-api/admin/signin", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce }),
    });
    out.textContent = r.ok
      ? "Signed in. The phone lines now show admin controls in this browser. You can close this tab."
      : "This link has already been used or has expired. Run scripts/live-setup.sh --link for a new one.";
  } catch { out.textContent = "Could not reach the phone lines. Try the link again."; }
})();
`;

export const SIGNIN_SCRIPT_HASH = `sha256-${createHash("sha256").update(SCRIPT).digest("base64")}`;

export const SIGNIN_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer"><title>High Desert · Phone Lines admin</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:Canvas;color:CanvasText;max-width:32rem;margin:15vh auto;padding:0 1rem}</style>
</head><body><h1>Phone Lines admin</h1><p id="out">Signing in…</p>
<script>${SCRIPT}</script></body></html>`;

export const SIGNIN_PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "content-security-policy": `default-src 'none'; script-src '${SIGNIN_SCRIPT_HASH}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
};
