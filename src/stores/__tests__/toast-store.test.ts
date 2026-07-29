import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useToastStore, toast } from "../toast-store";

/**
 * Toasts are how this app reports that something went wrong. "No visible error
 * state" is treated here as a defect of equal severity to the failure itself,
 * which makes the store that renders those messages worth pinning.
 */

function messages() {
  return useToastStore.getState().toasts.map((t) => t.message);
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe("adding toasts", () => {
  it("keeps at most five, dropping the oldest", () => {
    for (let i = 1; i <= 7; i++) useToastStore.getState().addToast(`msg ${i}`);
    expect(messages()).toEqual(["msg 3", "msg 4", "msg 5", "msg 6", "msg 7"]);
  });

  it("gives every toast a distinct id, so removing one does not take its neighbour", () => {
    const add = useToastStore.getState().addToast;
    add("same text");
    add("same text");

    const [first, second] = useToastStore.getState().toasts;
    expect(first.id).not.toBe(second.id);

    useToastStore.getState().removeToast(first.id);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].id).toBe(second.id);
  });

  it("removing an id that is not there leaves the list alone", () => {
    useToastStore.getState().addToast("still here");
    useToastStore.getState().removeToast("no-such-id");
    expect(messages()).toEqual(["still here"]);
  });

  it("defaults to an info toast lasting 4s", () => {
    useToastStore.getState().addToast("plain");
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: "info",
      duration: 4000,
    });
  });
});

describe("the status-bar mirror", () => {
  const seen: string[] = [];
  const onStatus = (e: Event) => seen.push((e as CustomEvent<string>).detail);

  beforeEach(() => {
    seen.length = 0;
    window.addEventListener("hd:status-message", onStatus);
  });
  afterEach(() => window.removeEventListener("hd:status-message", onStatus));

  it("mirrors a success toast to the status bar", () => {
    toast.success("Loaded 1,312 episodes");
    expect(seen).toEqual(["Loaded 1,312 episodes"]);
  });

  it("does NOT mirror an error", () => {
    // Deliberate: the status bar is a one-line ticker that is overwritten by the
    // next message, and an error needs to stay on screen. Mirroring it there
    // would make a failure look like it had been acknowledged and then scroll
    // it away — the "no visible error state" failure, one step removed.
    toast.error("Playback failed");
    expect(seen).toEqual([]);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: "error",
      duration: 6000,
    });
  });

  it("the caller toast is short-lived and does mirror", () => {
    toast.caller("Somewhere in the high desert…");
    expect(seen).toHaveLength(1);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: "caller",
      duration: 3000,
    });
  });
});

describe("toast helpers reach the store from outside React", () => {
  it("every helper lands in the store with its own type", () => {
    toast.success("s");
    toast.error("e");
    toast.info("i");
    toast.caller("c");
    expect(useToastStore.getState().toasts.map((t) => t.type)).toEqual([
      "success",
      "error",
      "info",
      "caller",
    ]);
  });

  it("survives a missing window without throwing", () => {
    // The helpers are called from services that also run during SSR.
    const w = globalThis.window;
    // @ts-expect-error — deleting window is the scenario under test
    delete globalThis.window;
    try {
      expect(() => toast.info("no dom")).not.toThrow();
    } finally {
      globalThis.window = w;
    }
    vi.restoreAllMocks();
  });
});
