/**
 * Reproduction capture for docs/timeline-rail.md — screenshots and measurements
 * of the library's year rail in every sort mode, at 1440 and 390 wide.
 *
 *   node docs/timeline-rail/capture.mjs [base-url]     # default http://127.0.0.1:3003
 *
 * Writes the PNGs and results.json next to this file. The regression checks
 * live in e2e/library-rail.spec.ts; this is the one-off evidence behind the doc.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
const BASE = (process.argv[2] ?? "http://127.0.0.1:3003").replace(/\/$/, "");
const OUT = path.dirname(new URL(import.meta.url).pathname);
fs.mkdirSync(OUT, { recursive: true });
const MODES = ["date", "name", "guest", "recent", "progress", "rated", "played", "series"];
const results = [];
const b = await chromium.launch();

async function waitSeeded(p) {
  await p.waitForFunction(async () => {
    const lb = document.querySelector('[role=listbox][aria-label=Episodes]');
    const slot = lb?.firstElementChild;
    if (!lb || !slot) return false;
    const n = Math.round(parseFloat(lb.style.height) / parseFloat(slot.style.height));
    return n >= 1300;
  }, null, { timeout: 60000, polling: 250 });
}

// Deterministic "returning listener" profile so recent/rated/played/progress are not degenerate.
async function seedListener(p) {
  await p.evaluate(() => new Promise((res, rej) => {
    const req = indexedDB.open("HighDesertDB");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("episodes", "readwrite");
      const st = tx.objectStore("episodes");
      const now = Date.now();
      let i = 0;
      st.openCursor().onsuccess = (e) => {
        const c = e.target.result;
        if (!c) return;
        const ep = c.value;
        if (i % 29 === 0) {
          const k = i / 29;
          ep.lastPlayedAt = now - k * 3_600_000 * 7;
          ep.playCount = 1 + ((k * 7) % 9);
          ep.rating = 1 + ((k * 3) % 5);
          if (k % 3 === 0 && ep.duration) ep.playbackPosition = Math.round(ep.duration * 0.4);
          c.update(ep);
        }
        i++;
        c.continue();
      };
      tx.oncomplete = () => { db.close(); res(i); };
      tx.onerror = () => rej(tx.error);
    };
    req.onerror = () => rej(req.error);
  }));
}

function measure(p) {
  return p.evaluate(() => {
    const lb = document.querySelector('[role=listbox][aria-label=Episodes]');
    if (!lb) return { empty: true };
    const sc = lb.parentElement;
    const slotH = parseFloat(lb.firstElementChild?.style.height ?? "0");
    const opts = [...lb.querySelectorAll('[role=option]')];
    const yearOf = (o) => (o.getAttribute("aria-label").match(/, (\d{4})-\d\d-\d\d(?: \(now playing\))?$/) || [])[1] ?? "Unknown";
    const slotTop = (o) => parseFloat(o.parentElement.style.top);
    const firstVisIdx = Math.floor(sc.scrollTop / slotH);
    const firstVis = opts.find((o) => Math.round(slotTop(o) / slotH) === firstVisIdx);
    const firstRendered = opts[0];
    const railBtns = [...document.querySelectorAll('button[title$=" episodes)"]')].filter((x) => /^\d{4} \(/.test(x.title));
    const active = railBtns.find((x) => x.className.includes("font-bold"));
    const railShown = railBtns.length > 0 && railBtns[0].offsetParent !== null;
    const header = sc.parentElement.parentElement.querySelector(":scope > .sticky span");
    return {
      scrollTop: Math.round(sc.scrollTop), scrollHeight: sc.scrollHeight,
      firstVisibleYear: firstVis ? yearOf(firstVis) : null,
      firstRenderedYear: firstRendered ? yearOf(firstRendered) : null,
      firstRenderedIdx: firstRendered ? Math.round(slotTop(firstRendered) / slotH) : null, firstVisIdx,
      headerYear: header?.textContent?.trim() ?? null,
      rail: railBtns.map((x) => x.title.slice(0, 4)),
      railShown,
      active: active?.title.slice(0, 4) ?? null,
      activeIdx: active ? railBtns.indexOf(active) : -1,
      activeY: active && railShown ? Math.round(active.getBoundingClientRect().top) : null,
    };
  });
}

// Walk the whole list top->bottom and record the year runs, i.e. the list's group order.
function listRuns(p) {
  return p.evaluate(async () => {
    const lb = document.querySelector('[role=listbox][aria-label=Episodes]');
    if (!lb) return [];
    const sc = lb.parentElement;
    const slotH = parseFloat(lb.firstElementChild?.style.height ?? "34");
    const seen = new Map();
    const yearOf = (o) => (o.getAttribute("aria-label").match(/, (\d{4})-\d\d-\d\d(?: \(now playing\))?$/) || [])[1] ?? "Unknown";
    for (let top = 0; ; top += sc.clientHeight) {
      sc.scrollTop = top;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (const o of lb.querySelectorAll('[role=option]')) seen.set(Math.round(parseFloat(o.parentElement.style.top) / slotH), yearOf(o));
      if (top + sc.clientHeight >= sc.scrollHeight) break;
    }
    sc.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ys = [...seen.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
    const runs = [];
    for (const y of ys) if (runs.at(-1) !== y) runs.push(y);
    return { count: ys.length, runs };
  });
}

const scrollTo = (p, frac) => p.evaluate(async (f) => {
  const sc = document.querySelector('[role=listbox][aria-label=Episodes]')?.parentElement;
  if (!sc) return;
  sc.scrollTop = Math.round((sc.scrollHeight - sc.clientHeight) * f);
  await new Promise((r) => setTimeout(r, 150));
}, frac);

for (const [vp, w, h, mob] of [["desktop", 1440, 900, false], ["mobile", 390, 844, true]]) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob, deviceScaleFactor: 1 });
  // The seeded listening history crosses the 2h/10h milestones; their dialog would cover the list.
  await ctx.addInitScript(() => localStorage.setItem("hd-milestones-seen", "[2,10,100]"));
  const p = await ctx.newPage();
  await p.goto(BASE + "/library");
  await waitSeeded(p);
  await p.waitForTimeout(3000);
  await seedListener(p);
  await p.reload();
  await waitSeeded(p);
  await p.waitForTimeout(800);
  console.log("played rows after reload:", await p.evaluate(() => new Promise((res) => { const r = indexedDB.open("HighDesertDB"); r.onsuccess = () => { const db = r.result; const g = db.transaction("episodes").objectStore("episodes").getAll(); g.onsuccess = () => { db.close(); res(g.result.filter((e) => e.lastPlayedAt).length); }; }; })));
  for (const mode of MODES) {
    if (mode === "series") {
      await p.evaluate(() => { window.dispatchEvent(new CustomEvent("hd:sort", { detail: "date" })); window.dispatchEvent(new CustomEvent("hd:filter-series", { detail: "Ghost to Ghost" })); });
    } else {
      await p.evaluate((m) => { window.dispatchEvent(new CustomEvent("hd:filter-series", { detail: null })); window.dispatchEvent(new CustomEvent("hd:sort", { detail: m })); }, mode);
    }
    await p.waitForTimeout(600);
    const { count = 0, runs = [] } = await listRuns(p);
    const samples = [];
    for (const f of [0, 0.25, 0.5, 0.75, 1]) { await scrollTo(p, f); samples.push({ f, ...(await measure(p)) }); }
    await scrollTo(p, 0);
    const clipBox = await p.evaluate(() => {
      const lb = document.querySelector('[role=listbox][aria-label=Episodes]');
      const root = lb ? lb.parentElement.parentElement.parentElement : document.querySelector("main") ?? document.body;
      const r = root.getBoundingClientRect();
      return { x: 0, y: Math.max(0, r.top - 4), width: window.innerWidth, height: Math.min(window.innerHeight, r.bottom + 4) - Math.max(0, r.top - 4) };
    });
    await p.screenshot({ path: `${OUT}/${vp}-${mode}-top.png`, clip: clipBox });
    if (count > 0) { await scrollTo(p, 0.4); await p.waitForTimeout(200); await p.screenshot({ path: `${OUT}/${vp}-${mode}-scrolled.png`, clip: clipBox }); await scrollTo(p, 0); }
    results.push({ vp, mode, count, runs, samples });
    console.log(vp, mode, count, "runs:", runs.length, runs.slice(0, 6).join(">"), "rail:", samples[0].rail?.[0], "..", samples[0].rail?.at(-1), "shown", samples[0].railShown,
      "active:", samples.map((s) => `${s.active}@${s.activeY}[vis ${s.firstVisibleYear}/rend ${s.firstRenderedYear}/hdr ${s.headerYear}]`).join(" "));
  }
  await ctx.close();
}
await b.close();
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results.map((r) => ({ ...r, runs: r.runs.length > 40 ? [...r.runs.slice(0, 20), "…", ...r.runs.slice(-5)] : r.runs, runCount: r.runs.length, samples: r.samples.map(({ rail, ...s }) => ({ ...s, railLength: rail?.length })) })), null, 1) + "\n");
