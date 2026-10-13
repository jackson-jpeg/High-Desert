import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";

/**
 * The phone lines UI, mounted for real (the component, its hook and the SSE
 * client) against a fake EventSource and a fake fetch. The server is not
 * modelled beyond the response shapes docs/live-chat.md documents.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.readyState = 2;
  }
  emit(name: string, data: unknown, id?: number) {
    this.readyState = 1;
    const e = new MessageEvent(name, { data: JSON.stringify(data), lastEventId: id === undefined ? "" : String(id) });
    for (const fn of this.listeners.get(name) ?? []) fn(e);
  }
}

let mobile = false;
function stubMedia() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("min-width: 768px") ? !mobile : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }));
}

// The presence feed is the other half of the site (src/services/stats/now-feed.ts);
// here it is a value the test controls. `live` is the one presence number for
// the live broadcast; until /api/stats/now carries it, it is undefined.
const presence: { online: number; listening: number; live?: number } = { online: 5, listening: 3 };
vi.mock("@/hooks/useCommunityNow", () => ({
  useCommunityNow: () => ({ ...presence, onAir: [], recent: [], loading: false, poll: 1 }),
}));

// The archive card's "Find the show" opens a library intent through the router.
const routerPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, replace: vi.fn() }),
  usePathname: () => "/live",
}));

const { LiveChat } = await import("../LiveChat");
const { fakeScrollBox } = await import("@/test-support/scroll-box");

const you = { name: "Night Owl in Pahrump", line: "Line 3", admin: false };
const slowOff = { on: false, until: null, intervalMs: 3000, forced: false };
const msg = (id: number, over: Partial<Record<string, unknown>> = {}) => ({
  id,
  at: "2026-09-25T06:00:00.000Z",
  name: `Caller ${id}`,
  line: "West of the Rockies",
  body: `call number ${id}`,
  ...over,
});

let fetchMock: ReturnType<typeof vi.fn>;
function respond(handler: (url: string, body: Record<string, unknown>) => [number, unknown]) {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const [status, json] = handler(url, init?.body ? JSON.parse(String(init.body)) : {});
    return new Response(JSON.stringify(json), { status });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function render() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(<LiveChat />));
  return {
    host,
    es: () => FakeEventSource.instances[FakeEventSource.instances.length - 1],
    done: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

const q = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (host: HTMLElement, id: string) => [...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit(form: HTMLElement) {
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  FakeEventSource.instances = [];
  vi.stubGlobal("EventSource", FakeEventSource);
  mobile = false;
  stubMedia();
  respond(() => [404, {}]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  delete presence.live;
});

describe("LiveChat (desktop)", () => {
  it("shows each call with its line label and caller name, in the Win98 window", () => {
    const { host, es, done } = render();
    expect(es().url).toBe("/live-api/stream");
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [msg(1), msg(2, { line: "Area 51 Line", name: "Desert Rat in Rachel" })], resumed: false, hidden: [] }, 2));
    act(() => es().emit("message", msg(3, { line: "Wildcard Line", name: "Insomniac in Ely", body: "is anyone else hearing this" }), 3));
    const rows = all(host, "live-message");
    expect(rows.map((r) => q(r, "line-label")!.textContent)).toEqual(["West of the Rockies", "Area 51 Line", "Wildcard Line"]);
    expect(rows.map((r) => q(r, "caller-name")!.textContent)).toEqual(["Caller 1", "Desert Rat in Rachel", "Insomniac in Ely"]);
    expect(q(rows[2], "message-body")!.textContent).toBe("is anyone else hearing this");
    expect(q(host, "phone-lines")!.dataset.variant).toBe("w98");
    // No chrome of its own: the Live screen's "Phone Lines" window holds it.
    expect(host.querySelector(".animate-window-open, h2, [role=dialog]")).toBeNull();
    expect(q(host, "you-name")!.textContent).toBe(you.name);
    done();
  });

  it("hide removes a call; rename renames it; a reconnect's hello drops what was hidden meanwhile", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [msg(1), msg(2), msg(3)], resumed: false, hidden: [] }, 3));
    act(() => es().emit("hide", { ids: [2] }));
    expect(all(host, "live-message").map((r) => r.dataset.id)).toEqual(["1", "3"]);
    act(() => es().emit("rename", { ids: [3], name: "Wildcard Line caller" }));
    expect(q(all(host, "live-message")[1], "caller-name")!.textContent).toBe("Wildcard Line caller");
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [msg(4)], resumed: true, hidden: [1] }, 4));
    expect(all(host, "live-message").map((r) => r.dataset.id)).toEqual(["3", "4"]);
    done();
  });

  it("sends a call, and shows the server's rejection reason inline", async () => {
    respond((url, body) => {
      if (url === "/live-api/messages" && String(body.body).includes("example.com")) {
        return [400, { error: "rejected", reason: "link", message: "Links can't go on the air." }];
      }
      if (url === "/live-api/messages") return [201, msg(10, { body: body.body, name: you.name, line: you.line })];
      return [404, {}];
    });
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const input = host.querySelector<HTMLInputElement>('[data-testid="composer"] input')!;
    type(input, "go to example.com");
    await submit(q(host, "composer")!);
    expect(fetchMock).toHaveBeenCalledWith("/live-api/messages", expect.objectContaining({ method: "POST" }));
    expect(q(host, "live-rejection")!.textContent).toBe("Links can't go on the air.");
    expect(q(host, "live-rejection")!.getAttribute("role")).toBe("alert");
    expect(input.value).toBe("go to example.com");

    type(input, "hello desert");
    expect(q(host, "live-rejection")).toBeNull();
    await submit(q(host, "composer")!);
    expect(input.value).toBe("");
    const row = all(host, "live-message").find((r) => r.dataset.id === "10")!;
    expect(q(row, "message-body")!.textContent).toBe("hello desert");
    // Your own call has no Report button.
    expect(q(row, "report")).toBeNull();
    done();
  });

  it("a call that goes through is the funnel's last step; a refused one is not", async () => {
    localStorage.setItem("hd-funnel", JSON.stringify({ cohort: "2026-09-27", device: "phone", done: ["visit"] }));
    respond((url, body) => {
      if (url === "/live-api/messages" && body.body === "refused") return [400, { error: "rejected", reason: "link", message: "No." }];
      if (url === "/live-api/messages") return [201, msg(11, { body: body.body, name: you.name, line: you.line })];
      return [200, { ok: true }];
    });
    const funnelPosts = () =>
      fetchMock.mock.calls.filter((c) => c[0] === "/api/stats/funnel").map((c) => JSON.parse(String((c[1] as RequestInit).body)));
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const input = host.querySelector<HTMLInputElement>('[data-testid="composer"] input')!;
    type(input, "refused");
    await submit(q(host, "composer")!);
    expect(funnelPosts()).toEqual([]);
    type(input, "hello desert");
    await submit(q(host, "composer")!);
    expect(funnelPosts()).toEqual([{ step: "call", cohort: "2026-09-27", device: "phone" }]);
    localStorage.clear();
    done();
  });

  it("a 429 shows how long to hold, and the button counts down", async () => {
    respond(() => [429, { error: "rate", retryAfter: 3 }]);
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const input = host.querySelector<HTMLInputElement>('[data-testid="composer"] input')!;
    type(input, "too fast");
    await submit(q(host, "composer")!);
    expect(q(host, "live-rejection")!.textContent).toMatch(/3 s/);
    expect(q(host, "send")!.textContent).toBe("3s");
    expect((q(host, "send") as HTMLButtonElement).disabled).toBe(true);
    done();
  });

  it("counts characters as the server does, and will not send past 280", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const input = host.querySelector<HTMLInputElement>('[data-testid="composer"] input')!;
    type(input, "\u{1F6F8}".repeat(280));
    expect(q(host, "char-count")!.textContent).toBe("280/280");
    expect((q(host, "send") as HTMLButtonElement).disabled).toBe(false);
    type(input, "\u{1F6F8}".repeat(281));
    expect(q(host, "char-count")!.textContent).toBe("281/280");
    expect((q(host, "send") as HTMLButtonElement).disabled).toBe(true);
    done();
  });

  it("Report posts the message id, then says Reported", async () => {
    respond((url) => (url === "/live-api/report" ? [200, { ok: true, hidden: false }] : [404, {}]));
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [msg(5)], resumed: false, hidden: [] }));
    await act(async () => {
      q(host, "report")!.click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    const call = fetchMock.mock.calls.find(([u]) => u === "/live-api/report")!;
    expect(JSON.parse(String(call[1].body))).toEqual({ messageId: 5 });
    expect(call[1].headers).toEqual({ "content-type": "application/json" });
    expect(q(host, "report")).toBeNull();
    expect(host.textContent).toContain("Reported");
    done();
  });

  it("Report is a quiet word beside the timestamp, not a button under the call, and keeps a 44 px target", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [msg(7)], resumed: false, hidden: [] }));
    const report = q(host, "report")!;
    const row = all(host, "live-message").find((r) => r.dataset.id === "7")!;
    // In the header line with the time, before the body.
    expect(report.parentElement!.querySelector("time")).not.toBeNull();
    expect(report.compareDocumentPosition(q(row, "message-body")!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Small text, no button chrome; the target is the ::after, 44 x 44.
    expect(report.className).toContain("text-hd-micro");
    const tokens = report.className.split(/\s+/);
    expect(tokens.filter((t) => /^(min-h-touch|min-w-touch)$|w98-raised|glass/.test(t))).toEqual([]);
    expect(report.className).toContain("after:min-h-touch");
    expect(report.className).toContain("after:min-w-touch");
    done();
  });

  it("admin controls appear only when the server says this session is an admin's", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [msg(6)], resumed: false, hidden: [] }));
    expect(q(host, "admin-controls")).toBeNull();
    expect(q(host, "admin-slow")).toBeNull();
    act(() => es().emit("hello", { you: { ...you, admin: true }, slowMode: slowOff, recent: [msg(6)], resumed: false, hidden: [] }));
    expect(q(host, "admin-controls")).not.toBeNull();
    expect(q(host, "admin-slow")).not.toBeNull();
    done();
  });

  it("shows slow mode when the room is in it", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    expect(q(host, "slow-mode")).toBeNull();
    act(() => es().emit("slow", { on: true, until: Date.now() + 60_000, intervalMs: 10_000, forced: false }));
    expect(q(host, "slow-mode")!.textContent).toBe("Slow mode: one call every 10 s");
    done();
  });

  it("the name editor sends the new name and shows a refusal", async () => {
    respond((url, body) =>
      url === "/live-api/name" && body.name === "Taken Name"
        ? [409, { error: "taken", message: "Someone on the lines already has that name." }]
        : url === "/live-api/name"
          ? [200, { name: body.name, line: "Line 3" }]
          : [404, {}],
    );
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    act(() => q(host, "change-name")!.click());
    const input = host.querySelector<HTMLInputElement>('[data-testid="name-editor"] input')!;
    type(input, "Taken Name");
    await submit(q(host, "name-editor")!);
    expect(q(host, "name-error")!.textContent).toBe("Someone on the lines already has that name.");
    type(input, "Rancher in Moab");
    await submit(q(host, "name-editor")!);
    expect(q(host, "name-editor")).toBeNull();
    expect(q(host, "you-name")!.textContent).toBe("Rancher in Moab");
    done();
  });

  it("the listener count is the presence feed's `live` number, not a count of chat connections", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    // Not there yet (the field is undefined): no number at all, rather than a guess.
    expect(q(host, "live-listeners")).toBeNull();
    done();
    presence.live = 7;
    const second = render();
    act(() => second.es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    expect(q(second.host, "live-listeners")!.dataset.live).toBe("7");
    expect(q(second.host, "live-listeners")!.textContent).toBe("7 tuned in live");
    // The chat service is never asked how many people are listening.
    expect(fetchMock.mock.calls.filter(([u]) => String(u).includes("health"))).toEqual([]);
    second.done();
  });
});

describe("LiveChat (mobile)", () => {
  it("draws glass inside the Live screen's sheet, with a 16px+ input that sends on the keyboard's Send key", () => {
    mobile = true;
    stubMedia();
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [msg(1)], resumed: false, hidden: [] }));
    const lines = q(host, "phone-lines")!;
    expect(lines.dataset.variant).toBe("glass");
    // The sheet (and its dialog role) is LiveChatSheet's, not a second one here.
    expect(host.querySelector("[role=dialog]")).toBeNull();
    const input = lines.querySelector<HTMLInputElement>('[data-testid="composer"] input')!;
    expect(input.getAttribute("enterkeyhint")).toBe("send");
    // text-hd-title is the 16px step: iOS zooms into anything smaller.
    expect(input.className).toMatch(/\btext-hd-title\b/);
    expect(q(lines, "line-label")!.textContent).toBe("West of the Rockies");
    done();
  });

  it("keeps the composer in view as the iOS keyboard arrives: it follows the visual viewport", () => {
    mobile = true;
    stubMedia();
    const vv = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, width: 390 });
    vi.stubGlobal("visualViewport", vv);
    vi.stubGlobal("innerHeight", 800);
    const scrolled = vi.fn();
    const proto = HTMLFormElement.prototype as unknown as { scrollIntoView?: unknown };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = scrolled;
    try {
      const { host, es, done } = render();
      act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
      const lines = () => q(host, "phone-lines")!;
      const input = host.querySelector<HTMLInputElement>('[data-testid="composer"] input')!;
      expect(lines().dataset.keyboardInset).toBe("0");
      act(() => input.focus());
      act(() => {
        vv.height = 460; // the keyboard takes 340px
        vv.dispatchEvent(new Event("resize"));
      });
      expect(lines().dataset.keyboardInset).toBe("340");
      expect(scrolled).toHaveBeenCalledTimes(1);
      expect(scrolled).toHaveBeenCalledWith({ block: "nearest" });
      act(() => {
        vv.offsetTop = 40; // Safari scrolled the visual viewport down too
        vv.dispatchEvent(new Event("scroll"));
      });
      expect(lines().dataset.keyboardInset).toBe("300");
      expect(scrolled).toHaveBeenCalledTimes(2);
      act(() => {
        vv.height = 800;
        vv.offsetTop = 0;
        vv.dispatchEvent(new Event("resize"));
      });
      expect(lines().dataset.keyboardInset).toBe("0");
      expect(scrolled).toHaveBeenCalledTimes(2);
      done();
    } finally {
      proto.scrollIntoView = had;
    }
  });

  it("does not scroll anything when the keyboard belongs to some other field", () => {
    mobile = true;
    stubMedia();
    const vv = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, width: 390 });
    vi.stubGlobal("visualViewport", vv);
    vi.stubGlobal("innerHeight", 800);
    const scrolled = vi.fn();
    const proto = HTMLFormElement.prototype as unknown as { scrollIntoView?: unknown };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = scrolled;
    try {
      const { es, done } = render();
      act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
      act(() => {
        vv.height = 460;
        vv.dispatchEvent(new Event("resize"));
      });
      expect(scrolled).not.toHaveBeenCalled();
      done();
    } finally {
      proto.scrollIntoView = had;
    }
  });
});

describe("Change name", () => {
  it("nameProblem: unchanged, empty and too long are refused locally, with a reason", async () => {
    const { nameProblem } = await import("../LiveChat");
    expect(nameProblem("  Night Owl  ", "Night Owl")).toBe("unchanged");
    expect(nameProblem("   ", "Night Owl")).toBe("Type a name first.");
    expect(nameProblem("x".repeat(33), "Night Owl")).toBe("Names can be at most 32 characters.");
    expect(nameProblem("x".repeat(32), "Night Owl")).toBeNull();
  });

  it("a name over the limit leaves Save pressable and says why — never a silent, disabled Save", async () => {
    const posted: unknown[] = [];
    respond((url, body) => {
      if (url.includes("/name")) posted.push(body);
      return [200, { name: body.name, line: "Line 3", nextChangeInS: 600 }];
    });
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    act(() => q(host, "change-name")!.click());
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Caller name"]')!;
    type(input, "A Very Long Caller Name From Beyond Tonopah");
    const save = q(host, "save-name") as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await submit(q(host, "name-editor")!);
    expect(q(host, "name-error")!.textContent).toBe("Names can be at most 32 characters.");
    expect(posted).toEqual([]);

    // A good name goes to the server, and the editor closes.
    type(input, "Radio Ghost in Beatty");
    await submit(q(host, "name-editor")!);
    expect(posted).toEqual([{ name: "Radio Ghost in Beatty" }]);
    expect(q(host, "name-editor")).toBeNull();
    done();
  });
});

describe("the call-in box", () => {
  it("its placeholder is short and names nobody: a 32-character name cut it off at 390 wide", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you: { ...you, name: "x".repeat(32) }, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const box = host.querySelector<HTMLInputElement>("input[placeholder]:not([aria-label='Caller name'])")!;
    expect(box.placeholder).toBe("Call in…");
    done();
  });
});

describe("calling from", () => {
  const brusselsZone = () => {
    const real = Intl.DateTimeFormat;
    return vi.spyOn(Intl, "DateTimeFormat").mockImplementation(((...args: ConstructorParameters<typeof Intl.DateTimeFormat>) => {
      const f = new real(...args);
      const resolved = f.resolvedOptions();
      return Object.assign(Object.create(f), { resolvedOptions: () => ({ ...resolved, timeZone: "Europe/Brussels" }) });
    }) as never);
  };

  beforeEach(() => localStorage.clear());

  it("a call shows where the caller is calling from, after the name; a call without a place shows the name alone", () => {
    const { host, es, done } = render();
    act(() =>
      es().emit("hello", {
        you,
        slowMode: slowOff,
        recent: [msg(1, { name: "Night Owl", place: "Ghent" }), msg(2, { name: "Dust Devil" })],
        resumed: false,
        hidden: [],
      }),
    );
    const [a, b] = all(host, "live-message");
    expect(a.textContent).toContain("Night Owl, calling from Ghent");
    expect(q(b, "caller-place")).toBeNull();
    // An admin's clear-name clears the place with it.
    act(() => es().emit("rename", { ids: [1], name: "Caller 7", place: null }));
    expect(q(all(host, "live-message")[0], "caller-place")).toBeNull();
    done();
  });

  it("a first call offers the field, suggested from the time zone, and the place goes up before the call", async () => {
    const zone = brusselsZone();
    const order: string[] = [];
    respond((url, body) => {
      order.push(url);
      if (url === "/live-api/place") return [200, { place: body.place, nextChangeInS: 600 }];
      if (url === "/live-api/messages") return [201, msg(20, { body: body.body, name: you.name, place: "Brussels" })];
      return [200, {}];
    });
    try {
      const { host, es, done } = render();
      act(() => es().emit("hello", { you: { ...you, place: null, firstCall: true }, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
      const field = q(host, "first-call-place") as HTMLInputElement;
      expect(field.value).toBe("Brussels");
      expect(q(host, "first-call-hint")!.textContent).toBe("First call? Say hello. Everyone tuned in hears it.");
      expect(host.textContent).not.toMatch(/—/);

      type(host.querySelector<HTMLInputElement>('input[aria-label="Your call"]')!, "evening all");
      await submit(q(host, "composer")!);
      expect(order.filter((u) => u.startsWith("/live-api/"))).toEqual(["/live-api/place", "/live-api/messages"]);
      expect(JSON.parse(String(fetchMock.mock.calls.find((c) => c[0] === "/live-api/place")![1].body))).toEqual({ place: "Brussels" });
      // Called: the offer and the hint are done.
      expect(q(host, "first-call-place")).toBeNull();
      expect(q(host, "first-call-hint")).toBeNull();
      expect(q(host, "you-place")!.textContent).toBe("Brussels");
      done();
    } finally {
      zone.mockRestore();
    }
  });

  it("the field is optional: emptied, nothing but the call is sent; a refused place stops the call and says why", async () => {
    const urls: string[] = [];
    respond((url, body) => {
      urls.push(url);
      if (url === "/live-api/place" && body.place === "<x>") return [400, { error: "rejected", reason: "place-chars", message: "Places can use letters." }];
      if (url === "/live-api/messages") return [201, msg(21, { body: body.body, name: you.name })];
      return [200, {}];
    });
    const { host, es, done } = render();
    act(() => es().emit("hello", { you: { ...you, place: null, firstCall: true }, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const field = q(host, "first-call-place") as HTMLInputElement;
    const box = host.querySelector<HTMLInputElement>('input[aria-label="Your call"]')!;

    type(field, "<x>");
    type(box, "hello");
    await submit(q(host, "composer")!);
    expect(urls).toEqual(["/live-api/place"]);
    expect(q(host, "live-rejection")!.textContent).toBe("Places can use letters.");
    expect(box.value).toBe("hello");

    type(field, "");
    await submit(q(host, "composer")!);
    expect(urls).toEqual(["/live-api/place", "/live-api/messages"]);
    done();
  });

  it("the hint is shown once per browser", () => {
    const first = render();
    act(() => first.es().emit("hello", { you: { ...you, firstCall: true }, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    expect(q(first.host, "first-call-hint")).not.toBeNull();
    first.done();
    const again = render();
    act(() => again.es().emit("hello", { you: { ...you, firstCall: true }, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    expect(q(again.host, "first-call-hint")).toBeNull();
    again.done();
  });

  it("the header changes it, and clears it", async () => {
    const posted: unknown[] = [];
    respond((url, body) => {
      if (url === "/live-api/place") {
        posted.push(body);
        return [200, { place: body.place || null, nextChangeInS: 600 }];
      }
      return [404, {}];
    });
    const { host, es, done } = render();
    act(() => es().emit("hello", { you: { ...you, place: "Denver" }, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    expect(q(host, "you-place")!.textContent).toBe("Denver");
    act(() => q(host, "change-place")!.click());
    type(host.querySelector<HTMLInputElement>('input[aria-label="Calling from"]')!, "Boulder");
    await submit(q(host, "place-editor")!);
    expect(q(host, "you-place")!.textContent).toBe("Boulder");

    act(() => q(host, "change-place")!.click());
    await act(async () => {
      q(host, "clear-place")!.click();
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });
    expect(posted).toEqual([{ place: "Boulder" }, { place: "" }]);
    expect(q(host, "you-place")).toBeNull();
    expect(q(host, "change-place")!.textContent).toBe("Add where you're calling from");
    done();
  });
});

describe("who you are, in one line (2026-10-13)", () => {
  it("Change name and Change place are two small words on one line, inside the sentence", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you: { ...you, place: "Asuncion" }, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const row = q(host, "you-row")!;
    const actions = q(host, "you-actions")!;
    const name = q(host, "change-name")!;
    const place = q(host, "change-place")!;
    // Both in the sentence's row, together in one part that never breaks.
    expect(row.contains(actions)).toBe(true);
    expect(actions.contains(name) && actions.contains(place)).toBe(true);
    expect(actions.className).toContain("whitespace-nowrap");
    // Text buttons the size of the words around them: no big padded button.
    for (const b of [name, place]) {
      expect(b.tagName).toBe("BUTTON");
      expect(b.className).toContain("text-hd-caption");
      expect(b.className).toContain("underline");
      const classes = b.className.split(/\s+/);
      for (const big of ["min-h-touch", "bg-raised-surface", "px-3", "rounded-lg"]) expect(classes).not.toContain(big);
      // The tap target stays 44 px, from the ::after.
      expect(b.className).toContain("after:min-h-touch");
    }
    done();
  });

  it("control: the call box's button is still a full-size button", () => {
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const send = q(host, "composer")!.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(send.className.split(/\s+/).some((c) => c === "min-h-touch" || c.startsWith("w98-button"))).toBe(true);
    done();
  });
});

describe("the room, where people decide to speak", () => {
  beforeEach(() => localStorage.clear());

  it("beside the call box: how many are tuned in now, from the one presence feed", () => {
    // Distinct from online (5) and listening (3), so the right one is read.
    presence.live = 6;
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [] }));
    const count = q(host, "call-box-listeners")!;
    expect(q(host, "composer")!.contains(count)).toBe(true);
    expect(count.textContent).toBe("6 tuned in now");
    expect(count.dataset.presence).toBe("live");
    expect(count.dataset.live).toBe("6");
    done();
  });

  it("tune-ins are quiet lines among the calls, in time order; a listener can hide them, and that is remembered", () => {
    const { host, es, done } = render();
    act(() =>
      es().emit("hello", {
        you,
        slowMode: slowOff,
        recent: [msg(1, { at: "2026-09-25T06:00:00.000Z" }), msg(2, { at: "2026-09-25T06:02:00.000Z" })],
        resumed: false,
        hidden: [],
        tuneins: [{ at: "2026-09-25T06:01:00.000Z", count: 1, places: ["Ohio"] }],
      }),
    );
    act(() => es().emit("tunein", { at: "2026-09-25T06:03:00.000Z", count: 2, places: [] }));
    const rows = [...host.querySelectorAll('[data-testid="live-messages"] > li')].map((li) =>
      li.getAttribute("data-testid") === "tunein-notice" ? li.textContent : `call ${li.getAttribute("data-id")}`,
    );
    expect(rows).toEqual(["call 1", "A listener just tuned in from Ohio", "call 2", "2 new listeners tuned in"]);

    act(() => q(host, "toggle-tuneins")!.click());
    expect(all(host, "tunein-notice")).toHaveLength(0);
    expect(all(host, "live-message")).toHaveLength(2);
    expect(q(host, "toggle-tuneins")!.textContent).toBe("Show tune-ins");
    done();

    const again = render();
    act(() => again.es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [], tuneins: [{ at: "2026-09-25T06:01:00.000Z", count: 1, places: [] }] }));
    expect(all(again.host, "tunein-notice")).toHaveLength(0);
    act(() => q(again.host, "toggle-tuneins")!.click());
    expect(all(again.host, "tunein-notice")).toHaveLength(1);
    again.done();
  });
});

describe("archive lines (2026-10-11): a moment from the show's history, never a call", () => {
  const moment = {
    id: "area-51-caller",
    at: "2026-09-25T06:01:00.000Z",
    text: "A caller who said he had worked at Area 51 broke down on the air.",
    form: "moment",
    speaker: null,
    episode: { airDate: "1997-09-11", title: "Coast to Coast AM - Open Lines with Area 51 Employees" },
    reason: "on-air",
  };
  const quote = {
    id: "sign-on",
    at: "2026-09-25T06:03:00.000Z",
    text: "From the high desert and the great American Southwest\u2026",
    form: "quote",
    speaker: "Art Bell",
    episode: null,
    reason: "archive",
  };

  it("in time order among the calls, marked as the archive, with no line, no caller and no Report", () => {
    const { host, es, done } = render();
    act(() =>
      es().emit("hello", {
        you,
        slowMode: slowOff,
        recent: [msg(1, { at: "2026-09-25T06:00:00.000Z" }), msg(2, { at: "2026-09-25T06:02:00.000Z" })],
        resumed: false,
        hidden: [],
        archive: [moment],
      }),
    );
    act(() => es().emit("archive", quote));
    const rows = [...host.querySelectorAll('[data-testid="live-messages"] > li')].map((li) =>
      li.getAttribute("data-testid") === "archive-line" ? `archive ${li.getAttribute("data-form")}` : `call ${li.getAttribute("data-id")}`,
    );
    expect(rows).toEqual(["call 1", "archive moment", "call 2", "archive quote"]);

    const [first, second] = all(host, "archive-line");
    expect(first.querySelector('[data-testid="archive-label"]')!.textContent).toBe("From the archive: this show");
    expect(second.querySelector('[data-testid="archive-label"]')!.textContent).toBe("From the archive");
    for (const card of [first, second]) {
      expect(card.querySelector('[data-testid="line-label"]')).toBeNull();
      expect(card.querySelector('[data-testid="caller-name"]')).toBeNull();
      expect(card.textContent).not.toMatch(/Report/);
    }
    // A description is never put in quotation marks; a quote is, with its speaker.
    expect(first.querySelector('[data-testid="archive-text"]')!.textContent).toBe(moment.text);
    expect(second.querySelector('[data-testid="archive-text"]')!.textContent).toBe(
      "\u201CFrom the high desert and the great American Southwest\u2026\u201D (Art Bell)",
    );
    expect(all(host, "live-message")).toHaveLength(2);
    done();
  });

  it("one from a show in the catalog finds it in the library", () => {
    routerPush.mockClear();
    const { host, es, done } = render();
    act(() => es().emit("hello", { you, slowMode: slowOff, recent: [], resumed: false, hidden: [], archive: [moment] }));
    const find = q(host, "archive-episode")!;
    expect(find.textContent).toBe("Find the show: Sep 11, 1997");
    act(() => find.click());
    expect(routerPush).toHaveBeenCalledWith(
      `/library?q=${encodeURIComponent(moment.episode.title).replace(/%20/g, "+")}`,
    );
    done();
  });
});

describe("readable lines (2026-10-13), on a desktop and on a phone", () => {
  const busy = (es: () => FakeEventSource) =>
    act(() =>
      es().emit("hello", {
        you: { ...you, name: "Night Owl", place: "Asuncion" },
        slowMode: slowOff,
        recent: [
          msg(1, { name: "Desert Rat", place: "Rachel", line: "Area 51 Line", at: "2026-09-25T06:00:00.000Z" }),
          msg(2, { name: "Night Owl", place: "Asuncion", line: "Line 3", at: "2026-09-25T06:05:00.000Z", body: "hello from me" }),
        ],
        resumed: false,
        hidden: [],
        tuneins: [
          { at: "2026-09-25T06:01:00.000Z", count: 1, places: [] },
          { at: "2026-09-25T06:02:00.000Z", count: 1, places: [] },
          { at: "2026-09-25T06:03:00.000Z", count: 1, places: [] },
        ],
        archive: [
          { id: "m1", at: "2026-09-25T06:04:00.000Z", text: "Art signs on.", form: "moment", speaker: null, episode: { airDate: "1997-03-13", title: "Area 51 caller" }, reason: "archive" },
        ],
      }),
    );

  for (const phone of [false, true]) {
    describe(phone ? "phone (glass)" : "desktop", () => {
      beforeEach(() => {
        mobile = phone;
        stubMedia();
      });

      it("each call is its own block: name, then place and line, then time; the message below", () => {
        const { host, es, done } = render();
        busy(es);
        const call = all(host, "live-message")[0];
        const head = q(call, "call-head")!;
        const body = q(call, "message-body")!;
        expect(head.contains(body)).toBe(false);
        expect(head.compareDocumentPosition(body) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect(q(head, "caller-name")!.textContent).toBe("Desert Rat");
        expect(q(head, "caller-name")!.className).toContain("font-bold");
        expect(q(head, "caller-place")!.textContent).toBe(", calling from Rachel");
        expect(q(head, "caller-place")!.className).toContain("text-bevel-dark");
        expect(q(head, "line-label")!.textContent).toBe("Area 51 Line");
        expect(q(head, "call-time")!.className).toContain("text-bevel-dark/85");
        expect(head.textContent!.replace(/\u00A0/g, " ")).toMatch(/^Desert Rat, calling from Rachel \u00B7 Area 51 Line/);
        expect(body.className).toContain("font-normal");
        done();
      });

      it("folds three tune-ins in a row into one small line", () => {
        const { host, es, done } = render();
        busy(es);
        const notices = all(host, "tunein-notice");
        expect(notices).toHaveLength(1);
        expect(notices[0].textContent).toBe("3 new listeners tuned in");
        expect(notices[0].className).toContain("text-hd-micro");
        expect(notices[0].className).toContain("truncate");
        done();
      });

      it("frames an archive moment, labelled, with Find the show inside it", () => {
        const { host, es, done } = render();
        busy(es);
        const block = q(host, "archive-line")!;
        expect(block.className).toContain("border-l-4");
        expect(block.className).toContain("ml-4");
        expect(q(block, "archive-label")!.textContent).toBe("From the archive");
        expect(q(block, "archive-episode")).not.toBeNull();
        done();
      });

      it("tints the caller's own call, and nobody else's (control)", () => {
        const { host, es, done } = render();
        busy(es);
        const [theirs, own] = all(host, "live-message");
        expect(own.dataset.mine).toBe("true");
        expect(own.className).toContain("bg-signal-blue/10");
        expect(theirs.dataset.mine).toBeUndefined();
        expect(theirs.className).not.toContain("bg-signal-blue/10");
        done();
      });

      it("scrolled up, a new call does not move the list and offers New calls below; at the bottom it follows", () => {
        const { host, es, done } = render();
        busy(es);
        const box = fakeScrollBox(q(host, "live-messages")!);
        box.scrollUp();
        box.grow(80);
        act(() => es().emit("message", msg(3, { name: "Insomniac", at: "2026-09-25T06:06:00.000Z" }), 3));
        expect(box.top).toBe(0);
        const button = q(host, "new-calls")!;
        expect(button.textContent).toContain("New calls below");
        act(() => button.click());
        expect(box.top).toBe(box.bottom);
        expect(q(host, "new-calls")).toBeNull();
        // Control: at the bottom, the next call is followed and nothing is offered.
        box.grow(80);
        act(() => es().emit("message", msg(4, { name: "Insomniac", at: "2026-09-25T06:07:00.000Z" }), 4));
        expect(box.top).toBe(box.bottom);
        expect(q(host, "new-calls")).toBeNull();
        done();
      });

      it("a tune-in arriving while scrolled up raises nothing", () => {
        const { host, es, done } = render();
        busy(es);
        const box = fakeScrollBox(q(host, "live-messages")!);
        box.scrollUp();
        act(() => es().emit("tunein", { at: "2026-09-25T06:09:00.000Z", count: 1, places: [] }));
        expect(q(host, "new-calls")).toBeNull();
        done();
      });
    });
  }
});
