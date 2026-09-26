#!/usr/bin/env node
/**
 * Load every route in headless Chromium and fail on any Content-Security-Policy
 * violation, uncaught page error, console error, or em dash in the page's copy.
 *
 * Why this exists: the CSP is enforced by the browser, not the server, so a
 * policy that blocks something the app needs does not fail a build, a unit
 * test or a status check. It shows up as a page that renders and then does
 * nothing. Dropping 'unsafe-eval' in production (HD-030) is only safe if every
 * route is known to run without it, and stays that way as dependencies move.
 *
 *   node scripts/csp-check.mjs                          # http://127.0.0.1:3000
 *   node scripts/csp-check.mjs https://highdesert.space
 *
 * Exits non-zero on any finding, or if any route does not return 200.
 */

import { chromium } from "playwright";

const BASE = (process.argv[2] ?? process.env.CSP_CHECK_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
const ROUTES = ["/", "/library", "/live", "/radio", "/stats", "/scanner", "/search"];
/** How long to let each page run after `load` — long enough for seeding, the first heartbeat and deferred effects. */
const SETTLE_MS = Number(process.env.CSP_CHECK_SETTLE_MS ?? 4000);

const browser = await chromium.launch();
const findings = [];

try {
  for (const route of ROUTES) {
    const context = await browser.newContext();
    const page = await context.newPage();
    const here = (kind, text) => findings.push({ route, kind, text: String(text).slice(0, 400) });

    // Chromium reports CSP blocks both as a console error and as a DOM event;
    // the event carries the directive, so record it from inside the page.
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI || "(inline)"}`);
      });
    });
    page.on("console", (msg) => {
      if (msg.type() === "error") here("console.error", msg.text());
    });
    page.on("pageerror", (err) => here("pageerror", err.message));

    let status = 0;
    try {
      const res = await page.goto(BASE + route, { waitUntil: "load", timeout: 30_000 });
      status = res?.status() ?? 0;
    } catch (err) {
      here("navigation", err.message);
    }
    if (status !== 200) here("status", `HTTP ${status}`);

    await page.waitForTimeout(SETTLE_MS);
    const violations = await page.evaluate(() => window.__cspViolations ?? []).catch(() => []);
    for (const v of violations) here("csp", v);

    // No em dashes in anything a visitor reads (the copy rule; the source-level
    // check is src/lib/__tests__/no-em-dash.test.ts). Visible text, the title,
    // meta descriptions and accessible labels. Callers' own words and names on
    // the phone lines are theirs, not the app's copy, and are left out.
    const dashes = await page
      .evaluate(() => {
        const DASH = "\u2014";
        const THEIRS = '[data-testid="message-body"], [data-testid="caller-name"], [data-testid="you-name"]';
        const out = [];
        const body = document.body.cloneNode(true);
        body.querySelectorAll(THEIRS).forEach((el) => el.remove());
        body.querySelectorAll("script, style, noscript").forEach((el) => el.remove());
        for (const line of (body.textContent ?? "").split(/\n+/)) if (line.includes(DASH)) out.push(`text: ${line.trim()}`);
        if (document.title.includes(DASH)) out.push(`title: ${document.title}`);
        for (const el of document.querySelectorAll("meta[content], [aria-label], [title], [placeholder], [alt]")) {
          if (el.closest(THEIRS)) continue;
          for (const a of ["content", "aria-label", "title", "placeholder", "alt"]) {
            const v = el.getAttribute(a);
            if (v && v.includes(DASH)) out.push(`${a}: ${v}`);
          }
        }
        return out;
      })
      .catch(() => []);
    for (const d of dashes) here("em-dash", d);

    const count = findings.filter((f) => f.route === route).length;
    console.log(`  ${count ? "FAIL" : "ok  "} ${route.padEnd(10)} HTTP ${status}${count ? `  (${count} finding(s))` : ""}`);
    await context.close();
  }
} finally {
  await browser.close();
}

if (findings.length) {
  console.log(`\n[csp-check] ${findings.length} finding(s) on ${BASE}\n`);
  for (const f of findings) console.log(`  ${f.route.padEnd(10)} ${f.kind.padEnd(14)} ${f.text}`);
  process.exit(1);
}
console.log(`\n[csp-check] ${ROUTES.length} routes on ${BASE}: no CSP violations, no console errors, no em dashes.`);
