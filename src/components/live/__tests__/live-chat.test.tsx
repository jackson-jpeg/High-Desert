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

const { LiveChat } = await import("../LiveChat");

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
