import { describe, expect, it } from "vitest";
import {
  LOOK_SPLIT_KEY,
  LOOK_SPLIT_RELOAD_KEY,
  LOOK_SPLIT_SCRIPT,
  SPLIT_FROM,
  SPLIT_UNTIL,
  splitLook,
  type SplitInput,
} from "../split";
import { shouldOfferNight } from "../choice";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const FROM = Date.parse(SPLIT_FROM);
const UNTIL = Date.parse(SPLIT_UNTIL);

function input(over: Partial<SplitInput> = {}): SplitInput {
  return {
    now: FROM + 3_600_000,
    from: FROM,
    until: UNTIL,
    width: 390,
    userAgent: IPHONE,
    cookie: "",
    priorVisit: false,
    random: 0.2,
    ...over,
  };
}

describe("splitLook", () => {
  it("gives a new phone visitor in the window one of the two looks, half each", () => {
    expect(splitLook(input({ random: 0 }))).toBe("night");
    expect(splitLook(input({ random: 0.4999 }))).toBe("night");
    expect(splitLook(input({ random: 0.5 }))).toBe("win98");
    expect(splitLook(input({ random: 0.9999 }))).toBe("win98");
  });

  it("is two weeks long, and does nothing outside it", () => {
    expect(UNTIL - FROM).toBe(14 * 86_400_000);
    expect(splitLook(input({ now: FROM - 1 }))).toBeNull();
    expect(splitLook(input({ now: FROM }))).not.toBeNull();
    expect(splitLook(input({ now: UNTIL - 1 }))).not.toBeNull();
    expect(splitLook(input({ now: UNTIL }))).toBeNull();
  });

  it("leaves desktops alone (768 px and wider)", () => {
    expect(splitLook(input({ width: 767 }))).not.toBeNull();
    expect(splitLook(input({ width: 768 }))).toBeNull();
    expect(splitLook(input({ width: 1280 }))).toBeNull();
    expect(splitLook(input({ width: 0 }))).toBeNull();
  });

  it("leaves a browser with a look cookie alone, whatever its value", () => {
    expect(splitLook(input({ cookie: "hd_look=win98" }))).toBeNull();
    expect(splitLook(input({ cookie: "a=1; hd_look=night; b=2" }))).toBeNull();
    // A cookie whose name merely ends in hd_look is not it.
    expect(splitLook(input({ cookie: "xhd_look=night" }))).not.toBeNull();
  });

  it("leaves a returning visitor alone", () => {
    expect(splitLook(input({ priorVisit: true }))).toBeNull();
  });

  it("leaves crawlers alone (they stay Win98)", () => {
    for (const ua of [
      "Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 7_0 like Mac OS X) (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
      "Mozilla/5.0 (Linux; Android 11) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0 Mobile Safari/537.36",
      "facebookexternalhit/1.1",
      "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36 Chrome-Lighthouse",
    ]) {
      expect(splitLook(input({ userAgent: ua })), ua).toBeNull();
    }
  });
});

/** A fake page for running the real inline script. */
function page(opts: { look?: string; local?: Record<string, string>; cookieBlocked?: boolean; width?: number; session?: Record<string, string> } = {}) {
  const local = new Map(Object.entries(opts.local ?? {}));
  const session = new Map(Object.entries(opts.session ?? {}));
  const cookies = new Map<string, string>();
  const attrs = new Map([["data-look", opts.look ?? "win98"]]);
  const style: Record<string, string> = {};
  const replaced: string[] = [];
  const store = (m: Map<string, string>) => ({
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
  });
  const document = {
    documentElement: { getAttribute: (k: string) => attrs.get(k) ?? null, style },
    get cookie() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(a: string) {
      if (opts.cookieBlocked) return;
      const [pair] = a.split(";");
      const [k, v] = pair.split("=");
      cookies.set(k, v);
    },
  };
  const window = {
    localStorage: store(local),
    sessionStorage: store(session),
    innerWidth: opts.width ?? 390,
  };
  const location = { protocol: "https:", href: "https://highdesert.space/live", replace: (u: string) => void replaced.push(u) };
  const navigator = { userAgent: IPHONE };
  return { document, window, location, navigator, local, session, cookies, style, replaced };
}

function run(p: ReturnType<typeof page>, now: number, random: number) {
  const date = class extends Date {
    static now() {
      return now;
    }
    constructor(...a: unknown[]) {
      super(...((a.length ? a : [now]) as [number]));
    }
  };
  const math = Object.create(Math, { random: { value: () => random } });
  new Function("document", "window", "location", "navigator", "Date", "Math", LOOK_SPLIT_SCRIPT)(
    p.document,
    p.window,
    p.location,
    p.navigator,
    date,
    math,
  );
}

describe("LOOK_SPLIT_SCRIPT", () => {
  const now = FROM + 3_600_000;

  it("assigns Night, records it, never offers Night, and reloads once into it", () => {
    const p = page();
    run(p, now, 0.1);
    expect(p.cookies.get("hd_look")).toBe("night");
    expect(p.local.get(LOOK_SPLIT_KEY)).toBe("night@2026-11-18");
    expect(p.local.get("hd-look-offer")).toBe("split");
    expect(p.style.visibility).toBe("hidden");
    expect(p.replaced).toEqual(["https://highdesert.space/live"]);
    expect(p.session.get(LOOK_SPLIT_RELOAD_KEY)).toBe("1");
  });

  it("assigns Win98 on the Win98 page without a reload", () => {
    const p = page();
    run(p, now, 0.9);
    expect(p.cookies.get("hd_look")).toBe("win98");
    expect(p.local.get("hd-look-offer")).toBe("split");
    expect(p.replaced).toEqual([]);
    expect(p.style.visibility).toBeUndefined();
  });

  it("the Night offer never shows to a browser in the split", () => {
    const p = page();
    run(p, now, 0.9);
    const real = globalThis.localStorage;
    const shim = { getItem: (k: string) => p.local.get(k) ?? null, setItem: () => {}, removeItem: () => {} };
    Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true });
    try {
      // Win98 cookie written: no offer. Even with the cookie gone, the mark holds.
      expect(shouldOfferNight("win98", "hd_look=win98")).toBe(false);
      expect(shouldOfferNight("win98", "")).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", { value: real, configurable: true });
    }
  });

  it("never reloads when the cookie does not stick (no loop)", () => {
    const p = page({ cookieBlocked: true });
    run(p, now, 0.1);
    expect(p.replaced).toEqual([]);
    expect(p.style.visibility).toBeUndefined();
  });

  it("never reloads a tab twice", () => {
    const p = page({ session: { [LOOK_SPLIT_RELOAD_KEY]: "1" } });
    run(p, now, 0.1);
    expect(p.replaced).toEqual([]);
  });

  it("does nothing for a returning browser, a desktop, or outside the window (control: the same page in the window assigns)", () => {
    for (const key of ["hd-visitor", "hd-funnel", "hd-look-chosen", "hd-look-offer", "hd-not-counted"]) {
      const p = page({ local: { [key]: "x" } });
      run(p, now, 0.1);
      expect(p.cookies.size, key).toBe(0);
      expect(p.replaced, key).toEqual([]);
    }
    const desk = page({ width: 1280 });
    run(desk, now, 0.1);
    expect(desk.cookies.size).toBe(0);
    const after = page();
    run(after, UNTIL, 0.1);
    expect(after.cookies.size).toBe(0);
    const control = page();
    run(control, now, 0.1);
    expect(control.cookies.size).toBe(1);
  });
});
