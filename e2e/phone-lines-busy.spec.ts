import { mkdirSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect, type Locator, type Page } from "./fixtures";

/**
 * The phone lines on a busy night, made readable (2026-10-13,
 * docs/phone-lines-2026-10-13/handoff.md). Every surface that shows calls, in
 * both looks: /live and /live?lines=1, on a phone (`mobile`, and `iphone`
 * with E2E_WEBKIT=1) and on a desktop.
 *
 * The chat service is not here (a local build has no highdesert-live), so
 * `/live-api/stream` is stubbed with page.route: the request goes to an SSE
 * server this spec runs, which sends a hello (fourteen calls, three tune-ins
 * in a row, an archive moment, a long wrapping call, one call of your own)
 * and then holds the stream open, so the spec can put a new call on the air
 * while the reader is scrolled up. Holding it open matters: a stream that
 * ends puts the lines into "Reconnecting".
 *
 * WebKit (`iphone`) gets nothing through a request sent on to another port,
 * so there the stream is fulfilled whole instead: hello, then the stream
 * ends, and each reconnect is held until the next call is put on the air and
 * answered with a hello that carries it. The lines say "Reconnecting" there,
 * so the status is not checked on WebKit; everything else is.
 *
 * Asserted: each call a separate block, its head (name, place, line, time)
 * above its message; the three tune-ins folded into "3 new listeners tuned
 * in" on one line; the archive moment framed and labelled with its link
 * inside; your own call tinted; "New calls below" when scrolled up, and
 * following at the bottom. Screenshots go to
 * test-results/phone-lines/<project>-<look>-<surface>.png for a person to
 * look at; they are evidence, not pixel baselines.
 *
 * The polish (2026-10-13, docs/lines-polish-2026-10-13/handoff.md), the
 * "polish" test per look: the sheet opens with no focus ring on Close (a ring
 * only once the keyboard moves focus); Night's "You're Night Owl on Line 3"
 * row has Change name and Change place as two small words on one line; and
 * Win98's Notepad keeps every call's time on the first line with its name,
 * the long ones included. Screenshots: <project>-<look>-polish.png.
 */

const LOOKS = ["win98", "night"] as const;
type Look = (typeof LOOKS)[number];
const OUT = "test-results/phone-lines";
mkdirSync(OUT, { recursive: true });

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const YOU = { name: "Night Owl", line: "Line 3", place: "Asuncion", firstCall: false, admin: false };
const LONG =
  "Art, I have been driving the 95 north of Beatty for three hours and every station on the dial goes to static at exactly the same mile marker, " +
  "then comes back with a voice reading numbers in what sounds like Portuguese. Has anyone else out here heard it tonight?";

type Call = { id: number; at: string; name: string; place: string | null; line: string; body: string };
function busyCalls(): Call[] {
  const c = (id: number, ago: number, name: string, place: string | null, line: string, body: string): Call => ({
    id,
    at: minutesAgo(ago),
    name,
    place,
    line,
    body,
  });
  return [
    c(1, 40, "Desert Rat", "Rachel", "Area 51 Line", "The lights over the ridge are back. Third night running."),
    c(2, 38, "Long-Haul Trucker", null, "West of the Rockies", LONG),
    c(3, 35, "Night Owl in Flagstaff", "Tucson", "Line 2", "Old name, new town. Still listening."),
    c(4, 30, "Sleepless Prospector", "Tonopah", "Wildcard Line", "Did Art ever find out who the Area 51 caller was?"),
    c(5, 26, "Night Owl", "Asuncion", "Line 3", "First time calling in. Hello from Paraguay!"),
    c(6, 24, "Insomniac", null, "Line 1", "Hello Paraguay!"),
    c(7, 22, "Skywatcher", "Sedona", "East of the Rockies", "Clear skies here. Nothing moving tonight."),
    c(8, 20, "Ham Radio Operator", "Ely", "Line 4", "Numbers stations are real. Look up the Lincolnshire Poacher."),
    c(9, 18, "Wandering Rancher", null, "Line 5", "My dog won't go near the north fence after dark."),
    c(10, 15, "Cab Driver", "Las Vegas", "Line 6", "Picked up a fare who asked for Rachel at 2 AM. Tipped in silver dollars."),
    c(11, 12, "Quiet Stargazer", null, "International Line", "Listening from Lisbon, it's morning here."),
    c(12, 9, "Time Traveler", null, "Area 51 Line", "I've heard this show before. It ends well."),
    c(13, 6, "Retired Engineer", "Barstow", "Line 2", "That signal is a repeater on a mountaintop. Probably."),
    c(14, 3, "Truck Stop Waitress", "Baker", "Line 1", "Coffee's on for anyone driving the 15 tonight."),
  ];
}

const HELLO = () => ({
  you: YOU,
  slowMode: { on: false, until: null, intervalMs: 3000, forced: false },
  recent: busyCalls(),
  resumed: false,
  hidden: [],
  // Three in a row, between calls 7 and 8: one line, "3 new listeners tuned in".
  tuneins: [
    { at: minutesAgo(21.5), count: 1, places: [] },
    { at: minutesAgo(21), count: 1, places: [] },
    { at: minutesAgo(20.5), count: 1, places: [] },
    // One on its own, after call 11.
    { at: minutesAgo(10), count: 1, places: ["Ohio"] },
  ],
  archive: [
    {
      id: "busy-moment",
      at: minutesAgo(16),
      text: "On 11 September 1997 a caller to the Area 51 line broke down on the air, and the satellite feed dropped moments later.",
      form: "moment",
      speaker: null,
      episode: { airDate: "1997-09-11", title: "Area 51 Caller" },
      reason: "archive",
    },
  ],
});

// ---------------------------------------------------------------------------
// The SSE stub: one per worker, every page's stream held open on it.

let server: Server;
let port = 0;
const streams = new Set<ServerResponse>();
let nextId = 100;
/** Calls put on the air since the page loaded, for a fulfilled (WebKit) stream's next hello. */
let aired: Call[] = [];
const onAir: (() => void)[] = [];

function frame(res: ServerResponse, event: string, data: unknown, id?: number) {
  res.write(`${id === undefined ? "" : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** Put a call on the air for every open page. */
function broadcast(body: string, name = "Coyote Hunter") {
  const call: Call = { id: nextId++, at: new Date().toISOString(), name, place: "Pahrump", line: "Line 4", body };
  for (const res of streams) frame(res, "message", call, call.id);
  aired.push(call);
  for (const wake of onAir.splice(0)) wake();
}

test.beforeEach(() => {
  aired = [];
});

test.beforeAll(async () => {
  server = createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    });
    res.write("retry: 600000\n\n");
    frame(res, "hello", HELLO(), 14);
    streams.add(res);
    req.on("close", () => streams.delete(res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as AddressInfo).port;
});

test.afterAll(async () => {
  for (const res of streams) res.end();
  streams.clear();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function enter(page: Page, baseURL: string, look: Look, path: string, browserName: string) {
  const host = new URL(baseURL).hostname;
  await page.context().addCookies([{ name: "hd_look", value: look, domain: host, path: "/", sameSite: "Lax" }]);
  if (browserName === "webkit") {
    let served = 0;
    await page.route("**/live-api/stream**", async (route) => {
      if (served++ > 0) await new Promise<void>((wake) => onAir.push(wake));
      const hello = HELLO();
      const res = { s: "retry: 300\n\n", write(t: string) { this.s += t; } };
      frame(res as unknown as ServerResponse, "hello", { ...hello, recent: [...hello.recent, ...aired] }, aired.at(-1)?.id ?? 14);
      await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store" }, body: res.s }).catch(() => {});
    });
  } else {
    await page.route("**/live-api/stream**", (route) => route.continue({ url: `http://127.0.0.1:${port}/stream` }));
  }
  await page.goto(path);
  await expect(page.locator("#app-loading")).toBeHidden({ timeout: 45_000 });
}

/** The lines drawn on this surface: the desktop's window, or a phone's sheet. */
function lines(page: Page): Locator {
  return page.locator('[data-testid="phone-lines"]:visible');
}

async function assertBusyLines(page: Page, look: Look, browserName: string) {
  const root = lines(page);
  await expect(root).toHaveCount(1, { timeout: 30_000 });
  const calls = root.getByTestId("live-message");
  await expect(calls).toHaveCount(14, { timeout: 30_000 });
  if (browserName !== "webkit") await expect(root.getByTestId("live-status")).toContainText(/On the air/);

  // Separate blocks, each head above its message, a little space between calls.
  const boxes = await calls.evaluateAll((els) =>
    els.map((el) => {
      const head = el.querySelector('[data-testid="call-head"]')!.getBoundingClientRect();
      const body = el.querySelector('[data-testid="message-body"]')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, headBottom: head.bottom, bodyTop: body.top };
    }),
  );
  for (const [i, b] of boxes.entries()) {
    expect(b.bodyTop, `call ${i + 1}: the message sits below its head`).toBeGreaterThanOrEqual(b.headBottom - 1);
    if (i > 0) expect(b.top - boxes[i - 1].bottom, `space between calls ${i} and ${i + 1}`).toBeGreaterThanOrEqual(2);
  }

  // The head: name bold, then ", calling from" and the line, then the time.
  const desert = calls.nth(0);
  await expect(desert.getByTestId("caller-name")).toHaveText("Desert Rat");
  expect(Number(await desert.getByTestId("caller-name").evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(desert.getByTestId("call-head")).toContainText("Desert Rat, calling from Rachel");
  // A place replaces the line (2026-10-13), and the place is italic, the name not.
  await expect(desert.getByTestId("line-label")).toHaveCount(0);
  expect(await desert.getByTestId("caller-place").evaluate((el) => getComputedStyle(el).fontStyle)).toBe("italic");
  expect(await desert.getByTestId("caller-name").evaluate((el) => getComputedStyle(el).fontStyle)).toBe("normal");
  expect(Number(await desert.getByTestId("message-body").evaluate((el) => getComputedStyle(el).fontWeight))).toBeLessThan(600);
  // An old generated name keeps working, and stays apart from the place.
  await expect(calls.nth(2).getByTestId("call-head")).toContainText("Night Owl in Flagstaff, calling from Tucson");
  // The long call wraps inside its block rather than running off the side.
  const long = calls.nth(1).getByTestId("message-body");
  const lb = await long.evaluate((el) => ({ h: el.getBoundingClientRect().height, sw: el.scrollWidth, cw: el.clientWidth }));
  expect(lb.h, "the long call wraps onto several lines").toBeGreaterThan(40);
  expect(lb.sw, "and nothing runs off the side").toBeLessThanOrEqual(lb.cw + 1);

  // Three tune-ins in a row: one small line.
  const notices = root.getByTestId("tunein-notice");
  await expect(notices).toHaveCount(2);
  await expect(notices.filter({ hasText: "3 new listeners tuned in" })).toHaveCount(1);
  const folded = notices.filter({ hasText: "3 new listeners tuned in" });
  const nh = await folded.evaluate((el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) || 16 }));
  expect(nh.h, "a notice is one line").toBeLessThan(nh.lh * 1.6);

  // The archive moment: framed, labelled, its link in the same block.
  const moment = root.getByTestId("archive-line");
  await expect(moment).toHaveCount(1);
  await expect(moment.getByTestId("archive-label")).toContainText("From the archive");
  await expect(moment.getByTestId("archive-episode")).toBeVisible();
  const frame = await moment.evaluate((el) => {
    const s = getComputedStyle(el);
    const list = el.parentElement!.getBoundingClientRect();
    return { left: parseFloat(s.borderLeftWidth), top: parseFloat(s.borderTopWidth), indent: el.getBoundingClientRect().left - list.left };
  });
  expect(frame.left, "a framed block").toBeGreaterThanOrEqual(3);
  expect(frame.top, "framed on every side").toBeGreaterThanOrEqual(1);
  expect(frame.indent, "indented").toBeGreaterThan(look === "win98" ? 12 : 10);

  // Your own call, tinted; nobody else's.
  const mine = root.locator('[data-testid="live-message"][data-mine]');
  await expect(mine).toHaveCount(1);
  await expect(mine.getByTestId("message-body")).toHaveText("First time calling in. Hello from Paraguay!");
  const bg = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(await bg(mine)).not.toBe(await bg(calls.nth(0)));
}

async function assertNewCallsBelow(page: Page) {
  const root = lines(page);
  const list = root.getByTestId("live-messages");
  const scroll = () => list.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }));
  await expect.poll(async () => (await scroll()).max, { message: "the busy list scrolls" }).toBeGreaterThan(100);

  // Scroll, and wait for the scroll event: scrollTop moves at once, but the
  // list learns where the reader is from the event, a frame later.
  const scrollTo = (to: "top" | "bottom") =>
    list.evaluate(
      (el, where) =>
        new Promise<void>((done) => {
          const target = where === "top" ? 0 : el.scrollHeight - el.clientHeight;
          if (Math.abs(el.scrollTop - target) < 1) return done();
          el.addEventListener("scroll", () => requestAnimationFrame(() => done()), { once: true });
          el.scrollTo({ top: target });
        }),
      to,
    );

  // At the bottom, a new call is followed and nothing is offered (the control).
  await scrollTo("bottom");
  broadcast("Following along at the bottom.");
  await expect(root.getByTestId("live-message").filter({ hasText: "Following along at the bottom." })).toHaveCount(1);
  await expect.poll(async () => { const s = await scroll(); return s.max - s.top; }).toBeLessThan(48);
  await expect(root.getByTestId("new-calls")).toHaveCount(0);

  // Scrolled up, the next one waits behind the button and does not move the reader.
  await scrollTo("top");
  await expect.poll(async () => (await scroll()).top).toBe(0);
  broadcast("This one arrives while you are reading back.");
  await expect(root.getByTestId("live-message").filter({ hasText: "This one arrives while you are reading back." })).toHaveCount(1);
  const button = root.getByTestId("new-calls");
  await expect(button).toBeVisible();
  await expect(button).toHaveText(/New calls below/);
  expect((await scroll()).top, "not yanked down").toBe(0);
  return async () => {
    await button.click();
    await expect.poll(async () => { const s = await scroll(); return s.max - s.top; }).toBeLessThan(48);
    await expect(root.getByTestId("new-calls")).toHaveCount(0);
  };
}

for (const look of LOOKS) {
  test.describe(`a busy night on the phone lines, ${look}`, () => {
    test("/live", async ({ page, baseURL, browserName }, info) => {
      await enter(page, baseURL!, look, "/live", browserName);
      const shot = `${OUT}/${info.project.name}-${look}-live.png`;
      if (info.project.use.isMobile) {
        // A phone's first screen: the latest calls in the preview, the same blocks.
        const preview = page.getByTestId("phone-lines-preview");
        await expect(preview.getByTestId("preview-call")).toHaveCount(3, { timeout: 30_000 });
        await preview.scrollIntoViewIfNeeded();
        await page.waitForTimeout(500);
        await page.screenshot({ path: shot });
        const last = preview.getByTestId("preview-call").last();
        await expect(last.getByTestId("caller-name")).toHaveText("Truck Stop Waitress");
        expect(Number(await last.getByTestId("caller-name").evaluate((el) => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
        await expect(last).toContainText("Truck Stop Waitress, calling from Baker");
        await expect(last.getByTestId("message-body")).toHaveText("Coffee's on for anyone driving the 15 tonight.");
        // The sheet holds the whole room, from the same stream.
        await preview.click();
        await assertBusyLines(page, look, browserName);
        await page.screenshot({ path: `${OUT}/${info.project.name}-${look}-sheet.png` });
      } else {
        await assertBusyLines(page, look, browserName);
        await page.waitForTimeout(500);
        await page.screenshot({ path: shot });
        const jump = await assertNewCallsBelow(page);
        await page.screenshot({ path: `${OUT}/${info.project.name}-${look}-live-new-calls.png` });
        await jump();
      }
    });

    test("/live?lines=1", async ({ page, baseURL, browserName }, info) => {
      await enter(page, baseURL!, look, "/live?lines=1", browserName);
      await assertBusyLines(page, look, browserName);
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/${info.project.name}-${look}-lines.png` });
      const jump = await assertNewCallsBelow(page);
      await page.screenshot({ path: `${OUT}/${info.project.name}-${look}-lines-new-calls.png` });
      await jump();
    });
  });
}

/** No button anywhere on the page wears a keyboard focus ring. */
async function ringedButtons(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("button"))
      .filter((b) => b.matches(":focus-visible"))
      .map((b) => b.getAttribute("aria-label") || b.textContent || b.tagName),
  );
}

async function assertTimeOnFirstLine(page: Page) {
  const calls = lines(page).getByTestId("live-message");
  const rows = await calls.evaluateAll((els) =>
    els.map((el) => {
      const name = el.querySelector('[data-testid="caller-name"]')!.getClientRects()[0];
      const time = el.querySelector('[data-testid="call-time"]')!.getBoundingClientRect();
      const head = el.querySelector('[data-testid="call-head"]')!.getBoundingClientRect();
      return { name: el.querySelector('[data-testid="caller-name"]')!.textContent, nameTop: name.top, nameBottom: name.bottom, timeTop: time.top, timeRight: time.right, headRight: head.right, headH: head.height };
    }),
  );
  let wrapped = 0;
  for (const r of rows) {
    // The time shares the first line with the name: its box starts within that line.
    expect(r.timeTop, `${r.name}: the time is on the first line`).toBeLessThan(r.nameBottom);
    expect(r.timeTop, `${r.name}: the time is on the first line`).toBeGreaterThanOrEqual(r.nameTop - 4);
    expect(r.timeRight, `${r.name}: inside the head`).toBeLessThanOrEqual(r.headRight + 1);
    if (r.headH > (r.nameBottom - r.nameTop) * 1.6) wrapped++;
  }
  return wrapped;
}

for (const look of LOOKS) {
  test.describe(`the phone lines, polished, ${look}`, () => {
    test("polish", async ({ page, baseURL, browserName }, info) => {
      const phone = !!info.project.use.isMobile;
      // A phone opens the sheet the way a link does (no tap first), which is
      // when a programmatic focus drew a ring on Close.
      await enter(page, baseURL!, look, "/live?lines=1", browserName);
      const root = lines(page);
      await expect(root.getByTestId("live-message")).toHaveCount(14, { timeout: 30_000 });
      await page.waitForTimeout(400);

      if (phone) {
        const sheet = page.getByTestId("live-chat-sheet");
        await expect(sheet).toBeVisible();
        // The trap moves focus a frame after the sheet opens (WebKit can be later).
        await expect
          .poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") ?? null), { message: "focus lands on the sheet" })
          .toBe("live-chat-sheet");
        expect(await ringedButtons(page), "no focus ring when the sheet opens").toEqual([]);
        // And the sheet, which holds the focus, draws no ring of its own.
        const ring = await sheet.evaluate((el) => {
          const st = getComputedStyle(el);
          return { outline: st.outlineStyle, shadow: st.boxShadow };
        });
        expect(ring.outline, "the sheet draws no outline").toBe("none");
        expect(ring.shadow.includes("212, 168, 67"), "nor an amber glow").toBe(false);
      }

      if (look === "night") {
        const row = root.getByTestId("you-row");
        await expect(row).toContainText("You\u2019re Night Owl on Line 3, calling from Asuncion");
        const name = root.getByTestId("change-name");
        const place = root.getByTestId("change-place");
        const [nb, pb, rb] = await Promise.all([name.boundingBox(), place.boundingBox(), row.boundingBox()]);
        expect(Math.abs(nb!.y - pb!.y), "Change name and Change place on one line").toBeLessThan(3);
        expect(nb!.height, "a small word, not a big button").toBeLessThan(26);
        expect(pb!.height).toBeLessThan(26);
        expect(rb!.height, "the whole row is at most two short lines").toBeLessThan(48);
        // The tap target is still 44 px tall, from the ::after.
        const target = await name.evaluate((el) => parseFloat(getComputedStyle(el, "::after").height));
        expect(target).toBeGreaterThanOrEqual(43);
      } else {
        const wrapped = await assertTimeOnFirstLine(page);
        // Control: on a phone some heads do wrap, so the check above saw a wrap.
        if (phone) expect(wrapped, "some heads wrap onto a second line").toBeGreaterThan(0);
      }

      await page.screenshot({ path: `${OUT}/${info.project.name}-${look}-polish.png` });

      if (phone) {
        // The keyboard still gets its ring: Tab from the sheet reaches Close, ringed.
        await page.keyboard.press("Tab");
        const ringed = await ringedButtons(page);
        expect(ringed.length, "Tab shows a focus ring").toBe(1);
        await page.screenshot({ path: `${OUT}/${info.project.name}-${look}-polish-keyboard.png` });
      }
    });
  });
}
