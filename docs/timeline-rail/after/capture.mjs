/**
 * "After the fix" capture for docs/timeline-rail.md: the rail in both date
 * directions at 1440 and 390 wide, top of the list and scrolled to 40%.
 *
 *   node docs/timeline-rail/after/capture.mjs [base-url]   # default http://127.0.0.1:3003
 *
 * Writes PNGs and results.json beside this file. The regression checks are
 * e2e/library-rail.spec.ts; this is the evidence behind the doc's table.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = (process.argv[2] ?? "http://127.0.0.1:3003").replace(/\/$/, "");
const OUT = path.dirname(new URL(import.meta.url).pathname);
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
};
const MODES = ["date", "date-asc"];
const results = [];
const browser = await chromium.launch();

const state = (p) =>
  p.evaluate(() => {
    const lb = document.querySelector('[role=listbox][aria-label=Episodes]');
    const sc = lb.parentElement;
    const slotH = parseFloat(lb.firstElementChild.style.height);
    const first = Math.floor(sc.scrollTop / slotH);
    const row = [...lb.querySelectorAll("[role=option]")].find((o) => Math.round(parseFloat(o.parentElement.style.top) / slotH) === first);
    const entries = [...document.querySelectorAll('[data-testid=year-rail] [data-group], [data-testid=year-scrubber] [data-group]')];
    const active = entries.find((e) => e.getAttribute("aria-current") === "true");
    return {
      firstVisibleYear: row?.getAttribute("aria-label").match(/, (\d{4})-/)?.[1] ?? null,
      rail: entries.map((e) => e.dataset.group),
      active: active?.dataset.group ?? null,
      activeY: active ? Math.round(active.getBoundingClientRect().top) : null,
      shown: entries.length > 0 && getComputedStyle(entries[0]).visibility !== "hidden" && entries[0].offsetParent !== null,
    };
  });

for (const [vp, opts] of Object.entries(VIEWPORTS)) {
  for (const mode of MODES) {
    const ctx = await browser.newContext(opts);
    const p = await ctx.newPage();
    await p.addInitScript(() => localStorage.setItem("hd-milestones-seen", "[2,10,100]"));
    await p.goto(`${BASE}/library`);
    await p.waitForFunction(() => {
      const lb = document.querySelector('[role=listbox][aria-label=Episodes]');
      const s = lb?.firstElementChild;
      return lb && s && Math.round(parseFloat(lb.style.height) / parseFloat(s.style.height)) >= 1300;
    }, null, { timeout: 60000 });
    await p.waitForSelector("#app-loading", { state: "hidden", timeout: 10000 });
    await p.evaluate((m) => window.dispatchEvent(new CustomEvent("hd:sort", { detail: m })), mode);
    await p.waitForTimeout(600);
    const shot = async (label, frac) => {
      await p.evaluate(async (f) => {
        const sc = document.querySelector('[role=listbox][aria-label=Episodes]').parentElement;
        sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * f) + 1; // +1 then exact: wakes the phone scrubber
        await new Promise((r) => requestAnimationFrame(r));
        sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * f);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, frac);
      await p.waitForTimeout(350); // fade-in
      const s = await state(p);
      await p.screenshot({ path: path.join(OUT, `${vp}-${mode}-${label}.png`) });
      results.push({ viewport: vp, mode, at: label, ...s, rail: s.rail.join(" ") });
    };
    await shot("top", 0);
    await shot("scrolled", 0.4);
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2) + "\n");
for (const r of results) console.log(r.viewport, r.mode, r.at, "first", r.firstVisibleYear, "active", r.active, "y", r.activeY, "shown", r.shown, "|", r.rail);
