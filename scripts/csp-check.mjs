#!/usr/bin/env node
/**
 * Load every route in headless Chromium and fail on any Content-Security-Policy
 * violation, uncaught page error, or console error.
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
console.log(`\n[csp-check] ${ROUTES.length} routes on ${BASE}: no CSP violations, no console errors.`);
