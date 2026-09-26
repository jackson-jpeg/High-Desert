import { describe, it, expect, afterEach, vi } from "vitest";
import { backoffMs, connectLive, charCount, sendMessage, changeName, type LiveHandlers } from "../client";
import { keyboardInset } from "@/hooks/useKeyboardInset";

class FakeEventSource {
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onerror: (() => void) | null = null;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  closed = false;
  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
    this.readyState = 2;
  }
  emit(name: string, data: unknown, id?: string) {
    for (const fn of this.listeners.get(name) ?? []) fn(new MessageEvent(name, { data: JSON.stringify(data), lastEventId: id ?? "" }));
  }
  fail(permanently: boolean) {
    this.readyState = permanently ? 2 : 0;
    this.onerror?.();
  }
}

const handlers = (): LiveHandlers & { statuses: string[] } => {
  const statuses: string[] = [];
  return { statuses, hello: vi.fn(), message: vi.fn(), hide: vi.fn(), rename: vi.fn(), slow: vi.fn(), status: (s) => statuses.push(s) };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeEventSource.instances = [];
});

describe("connectLive", () => {
  it("when the browser gives up, reopens with backoff and resumes from the last event id", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    const h = handlers();
    const conn = connectLive(h, { random: () => 1 });
    const first = FakeEventSource.instances[0];
    expect(first.url).toBe("/live-api/stream");
    first.emit("hello", { you: {}, slowMode: {}, recent: [], resumed: false, hidden: [] }, "41");
    first.emit("message", { id: 42 }, "42");
    expect(h.message).toHaveBeenCalledWith({ id: 42 });

    // A transient drop: the browser retries by itself; we do not open another.
    first.fail(false);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(h.statuses.at(-1)).toBe("reconnecting");

    // A 502 while the service restarts: the browser closes it. We back off...
    first.fail(true);
    expect(first.closed).toBe(true);
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    const second = FakeEventSource.instances[1];
    // ...and resume after the last id we saw.
    expect(second.url).toBe("/live-api/stream?lastEventId=42");

    second.fail(true);
    vi.advanceTimersByTime(1_999);
    expect(FakeEventSource.instances).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(3);

    // A hello resets the backoff.
    FakeEventSource.instances[2].emit("hello", { you: {}, slowMode: {}, recent: [], resumed: true, hidden: [] });
    expect(h.statuses.at(-1)).toBe("live");
    FakeEventSource.instances[2].fail(true);
    vi.advanceTimersByTime(1_000);
    expect(FakeEventSource.instances).toHaveLength(4);
    conn.close();
    expect(FakeEventSource.instances[3].closed).toBe(true);
  });

  it("closing stops any pending reconnect", () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", FakeEventSource);
    const conn = connectLive(handlers());
    FakeEventSource.instances[0].fail(true);
    conn.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("backoff doubles to a 30 s cap, with jitter in [50%, 100%]", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((a) => backoffMs(a, () => 1))).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
    expect(backoffMs(3, () => 0)).toBe(4000);
  });
});

describe("helpers", () => {
  it("counts code points, trimmed, as the server does", () => {
    expect(charCount("  a\u{1F6F8}b  ")).toBe(3);
  });

  it("keyboardInset: the strip below the visual viewport, ignoring chrome wobble", () => {
    expect(keyboardInset(800, { height: 460, offsetTop: 0 })).toBe(340);
    expect(keyboardInset(800, { height: 460, offsetTop: 40 })).toBe(300);
    expect(keyboardInset(800, { height: 790, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, null)).toBe(0);
  });
});

describe("refusals read as what they are", () => {
  const reply = (status: number, json: unknown) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(json), { status })));

  it("a held network's 429 shows the server's sentence, not a caller's pace", async () => {
    const message = "New callers from your network are on hold for a while. Try again later.";
    reply(429, { error: "address-hold", retryAfter: 3600, message });
    const call = await sendMessage("hello");
    expect(call).toMatchObject({ ok: false, reason: "address-hold", message });
    const name = await changeName("Night Owl");
    expect(name).toMatchObject({ ok: false, reason: "address-hold", message });
  });

  it("the caller's own pace still says how long to wait (the control)", async () => {
    reply(429, { error: "rate", retryAfter: 3 });
    expect(await sendMessage("hello")).toMatchObject({ reason: "rate", message: "Hold the line. You can call again in 3 s." });
    reply(429, { error: "rate", retryAfter: 300 });
    expect(await changeName("Night Owl")).toMatchObject({ reason: "rate", message: "Names can change once every 10 minutes: 5 min to go." });
  });
});
