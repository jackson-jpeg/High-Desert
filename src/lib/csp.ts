/**
 * The Content-Security-Policy, as a list of directives.
 *
 * `'unsafe-eval'` is a development-only need (React's dev build and HMR use
 * eval for source maps and fast refresh); production Next does not eval, so
 * shipping it there only widened what an injected script could do.
 * `'unsafe-inline'` stays: Next's inline bootstrap scripts need it without a
 * nonce pipeline. `scripts/csp-check.mjs` loads every route in Chromium and
 * fails on any CSP violation, so a dependency that starts needing eval shows
 * up in CI rather than as a blank page.
 */
export function contentSecurityPolicy(dev: boolean): string[] {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://archive.org https://*.archive.org",
    "media-src 'self' blob: https://archive.org https://*.archive.org",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self' https://sang3r.com https://www.sang3r.com",
  ];
}
