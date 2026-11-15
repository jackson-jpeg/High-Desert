/**
 * The meter tone and the VU needle, shared by the specs that listen to what
 * the player outputs (meters.spec.ts, dsp-player.spec.ts).
 *
 * The tone (e2e/assets/meter-tone.mp3) alternates loud and quiet every
 * second; served for any audio URL with byte ranges, with or without CORS.
 * The needle is read off the rendered VU meter's canvas, never a test-only number.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page, Route } from "@playwright/test";
import { expect } from "./fixtures";
import { id3Length, parseHeader } from "../src/audio/level-tap/mpeg";

/**
 * The committed tone is 45 s; a slow run outlasts it, and a show that ends
 * that early is judged empty (duration-sanity.ts). So what is served is its
 * ID3 tag and then its audio frames twenty times over (15 minutes): the same
 * constant-bitrate frames, minus the Info frame, whose length would no longer
 * be true.
 */
export const FIXTURE = (() => {
  const file = readFileSync(path.join(process.cwd(), "e2e", "assets", "meter-tone.mp3"));
  const tag = id3Length(file);
  const info = parseHeader(file, tag);
  if (!info) throw new Error("meter-tone.mp3: no frame after the tag");
  const audio = file.subarray(tag + info.length);
  return Buffer.concat([file.subarray(0, tag), ...Array.from({ length: 20 }, () => audio)]);
})();

/** Answer an audio request from the fixture, honouring a single byte range. */
export function serveFixture(route: Route, cors: boolean) {
  const req = route.request();
  const corsHeaders: Record<string, string> = cors ? { "access-control-allow-origin": "*" } : {};
  if (req.method() === "OPTIONS") {
    return route.fulfill({
      status: 204,
      headers: { ...corsHeaders, "access-control-allow-methods": "GET, HEAD, OPTIONS", "access-control-allow-headers": "Range" },
    });
  }
  const size = FIXTURE.length;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers()["range"] ?? "");
  if (!m) {
    return route.fulfill({ status: 200, body: FIXTURE, headers: { ...corsHeaders, "content-type": "audio/mpeg", "accept-ranges": "bytes" } });
  }
  let start: number;
  let end: number;
  if (m[1] === "") {
    start = Math.max(0, size - Number(m[2]));
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size) {
    return route.fulfill({ status: 416, headers: { ...corsHeaders, "content-range": `bytes */${size}` } });
  }
  return route.fulfill({
    status: 206,
    body: FIXTURE.subarray(start, end + 1),
    headers: { ...corsHeaders, "content-type": "audio/mpeg", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}` },
  });
}

/** The biggest visualizer on screen. */
export async function bigViz(page: Page) {
  const all = page.locator('[role="button"][aria-label^="Audio visualization"]');
  let best = all.first();
  let area = -1;
  for (let i = 0; i < (await all.count()); i++) {
    const box = await all.nth(i).boundingBox();
    if (box && box.width * box.height > area) {
      area = box.width * box.height;
      best = all.nth(i);
    }
  }
  return best;
}

/** Cycle the big visualizer to the VU meter, as a listener does: tap it. */
export async function chooseVu(page: Page) {
  for (let i = 0; i < 9; i++) {
    const viz = await bigViz(page);
    if ((await viz.getAttribute("aria-label")) === "Audio visualization: VU Meter") return viz;
    await viz.click();
  }
  throw new Error("never reached the VU meter");
}

/**
 * The left needle's position, 0 (rest) to 1 (full scale), read off the
 * canvas: the angle around the pivot where the white needle crosses a
 * circle inside the gauge (viz-vu.ts draws it from (0.28w, 0.6h)).
 */
export function needle(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const viz = [...document.querySelectorAll('[role="button"][aria-label="Audio visualization: VU Meter"]')]
      .map((el) => el.querySelector("canvas"))
      .filter((c): c is HTMLCanvasElement => !!c)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!viz) return null;
    const W = viz.width;
    const H = viz.height;
    const data = viz.getContext("2d")!.getImageData(0, 0, W, H).data;
    const radius = Math.min(W * 0.22, H * 0.4);
    const cx = W * 0.28;
    const cy = H * 0.6;
    let best = -1;
    let bestAngle = 0;
    for (let a = -Math.PI; a <= -0.05; a += 0.005) {
      let score = 0;
      for (const f of [0.45, 0.55, 0.65]) {
        const x = Math.round(cx + Math.cos(a) * radius * f);
        const y = Math.round(cy + Math.sin(a) * radius * f);
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = (y * W + x) * 4;
        score += Math.min(data[i], data[i + 1], data[i + 2]);
      }
      if (score > best) {
        best = score;
        bestAngle = a;
      }
    }
    if (best < 3 * 150) return 0;
    return (bestAngle + Math.PI) / (Math.PI - 0.05);
  });
}

/** Needle positions over `ms`, every 100 ms. */
export async function sampleNeedle(page: Page, ms: number): Promise<number[]> {
  const out: number[] = [];
  for (let t = 0; t < ms; t += 100) {
    const v = await needle(page);
    if (v !== null) out.push(v);
    await page.waitForTimeout(100);
  }
  return out;
}

/**
 * The meters follow the tone: the needle reaches well up the scale on the
 * loud seconds and falls back on the quiet ones. A meter at rest, or one fed
 * anything flat, fails both.
 */
export async function expectMetersMove(page: Page, when: string) {
  const s = await sampleNeedle(page, 3_500);
  const max = Math.max(...s);
  const min = Math.min(...s);
  expect(s.length, `${when}: the VU meter must be on screen`).toBeGreaterThan(20);
  expect(max, `${when}: the needle never rose (samples ${s.map((v) => v.toFixed(2)).join(" ")})`).toBeGreaterThan(0.45);
  expect(max - min, `${when}: the needle never moved with the tone (samples ${s.map((v) => v.toFixed(2)).join(" ")})`).toBeGreaterThan(0.25);
}

