import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  INSTALL_KEY,
  MIN_VISITS,
  SNOOZE_DAYS,
  VISITS_KEY,
  VISIT_SESSION_KEY,
  captureInstallPrompt,
  dayOf,
  dismissInstall,
  installMode,
  isDismissed,
  isIosSafari,
  nextDismissal,
  nextVisits,
  noteVisit,
  promptInstall,
  readDismissal,
  resetInstallPromptForTests,
} from "@/services/install/install-prompt";

/**
 * The home-screen prompt's rules (src/services/install/install-prompt.ts):
 * from the second visit, where it can be acted on, never once installed, and
 * a dismissal is respected (90 days, then for good).
 */

const DAY = 24 * 60 * 60 * 1000;
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
  iphoneInApp: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0] Version/18.0 Safari/604.1",
  android: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetInstallPromptForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("visits", () => {
  it("a new session or a new day is a visit; another page in the same session and day is not", () => {
    const today = "2026-10-12";
    const first = nextVisits(null, { newSession: true, today });
    expect(first).toEqual({ n: 1, day: today });
    expect(nextVisits(first, { newSession: false, today })).toBe(first);
    expect(nextVisits(first, { newSession: true, today })).toEqual({ n: 2, day: today });
    expect(nextVisits(first, { newSession: false, today: "2026-10-13" })).toEqual({ n: 2, day: "2026-10-13" });
  });

  it("counts through storage: once per session and day, again in a new session", () => {
    const now = new Date(2026, 9, 12, 21, 0);
    expect(noteVisit(now)).toBe(1);
    expect(noteVisit(now)).toBe(1);
    expect(sessionStorage.getItem(VISIT_SESSION_KEY)).toBe("1");
    sessionStorage.clear(); // the tab was closed; a new one opened
    expect(noteVisit(now)).toBe(2);
    expect(JSON.parse(localStorage.getItem(VISITS_KEY)!)).toEqual({ n: 2, day: dayOf(now) });
    // The next morning, same tab.
    expect(noteVisit(new Date(2026, 9, 13, 8, 0))).toBe(3);
  });

  it("counts nothing where storage cannot be written, so nothing is offered on every load", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(noteVisit()).toBe(0);
    expect(noteVisit()).toBe(0);
  });

  it("a session that cannot be marked counts nothing, even where the count itself could be kept", () => {
    // Session storage blocked, local storage fine (a private-mode quirk): every
    // page load would look like a new session and count, and a first visit's
    // second page would already be offered the install.
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, k: string, v: string) {
      if (this === sessionStorage) throw new DOMException("blocked", "SecurityError");
      return write.call(this, k, v);
    });
    const now = new Date(2026, 9, 12, 21, 0);
    expect(noteVisit(now)).toBe(0);
    expect(noteVisit(now)).toBe(0);
    expect(noteVisit(now)).toBe(0);
    expect(localStorage.getItem(VISITS_KEY)).toBeNull();
  });

  it("a corrupt record starts again rather than throwing", () => {
    localStorage.setItem(VISITS_KEY, "{not json");
    expect(noteVisit(new Date(2026, 9, 12))).toBe(1);
  });
});

describe("installMode", () => {
  const base = {
    visits: MIN_VISITS,
    standalone: false,
    dismissal: { dismissals: 0, until: null },
    now: Date.UTC(2026, 9, 12),
    canPrompt: false,
    iosSafari: false,
  };

  it("offers nothing on a first visit", () => {
    expect(installMode({ ...base, visits: 1, canPrompt: true })).toBeNull();
    expect(installMode({ ...base, visits: 1, iosSafari: true })).toBeNull();
  });

  it("from the second visit: the Install button where the browser offers one, the steps on iPhone Safari", () => {
    expect(installMode({ ...base, canPrompt: true })).toBe("install");
    expect(installMode({ ...base, iosSafari: true })).toBe("ios");
    expect(installMode(base)).toBeNull();
  });

  it("never in the installed app", () => {
    expect(installMode({ ...base, standalone: true, canPrompt: true })).toBeNull();
    expect(installMode({ ...base, standalone: true, iosSafari: true })).toBeNull();
  });

  it("a first Not now holds for 90 days, then it may come back once; a second is for good", () => {
    const now = base.now;
    const once = nextDismissal({ dismissals: 0, until: null }, now);
    expect(once).toEqual({ dismissals: 1, until: now + SNOOZE_DAYS * DAY });
    expect(installMode({ ...base, canPrompt: true, dismissal: once, now: now + 89 * DAY })).toBeNull();
    expect(installMode({ ...base, canPrompt: true, dismissal: once, now: now + 91 * DAY })).toBe("install");
    const twice = nextDismissal(once, now + 91 * DAY);
    expect(twice).toEqual({ dismissals: 2, until: null });
    expect(isDismissed(twice, now + 10_000 * DAY)).toBe(true);
  });

  it("dismissInstall stores it", () => {
    dismissInstall(1000);
    expect(readDismissal()).toEqual({ dismissals: 1, until: 1000 + SNOOZE_DAYS * DAY });
    expect(JSON.parse(localStorage.getItem(INSTALL_KEY)!).dismissals).toBe(1);
  });
});

describe("isIosSafari", () => {
  it("iPhone and iPad Safari, and nothing else", () => {
    expect(isIosSafari(UA.iphoneSafari, 5)).toBe(true);
    expect(isIosSafari(UA.ipadOs, 5)).toBe(true);
    expect(isIosSafari(UA.macSafari, 0)).toBe(false);
    expect(isIosSafari(UA.iphoneChrome, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneInApp, 5)).toBe(false);
    expect(isIosSafari(UA.iphoneFacebook, 5)).toBe(false);
    expect(isIosSafari(UA.android, 5)).toBe(false);
  });
});

describe("the browser's install event", () => {
  function fire() {
    const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<{ outcome: string; platform: string }>;
    };
    e.prompt = vi.fn(async () => ({ outcome: "accepted", platform: "web" }));
    window.dispatchEvent(e);
    return e;
  }

  it("is captured (the browser's own mini-infobar held back), prompted once, and an install is never offered again", async () => {
    const release = captureInstallPrompt();
    const e = fire();
    expect(e.defaultPrevented).toBe(true);
    expect(await promptInstall()).toBe("accepted");
    expect(e.prompt).toHaveBeenCalledTimes(1);
    expect(await promptInstall()).toBeNull();
    expect(isDismissed(readDismissal(), Date.now())).toBe(true);
    release();
  });

  it("is not listened for once released", async () => {
    captureInstallPrompt()();
    fire();
    expect(await promptInstall()).toBeNull();
  });
});
