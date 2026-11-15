import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeMediaElement, setReadyState } from "@/hooks/__tests__/support/mount-player";

/**
 * The browser side of Level and Clean up (src/audio/processing.ts), against a
 * recording fake of Web Audio. What it holds:
 *
 * - nothing is routed on iOS, or before a switch (or a visualizer) wants it;
 * - routing waits for a *running* context and a loaded (or failed) module,
 *   so a suspended context can never swallow the show;
 * - the graph: source → worklet → wet and source → delay → dry (0), both into
 *   the analyser, then the listener's volume; element.volume held at 1;
 * - every failure lands on plain sound or a pause with a message, never
 *   silence: module load fails, processor error, quiet worklet, stalled
 *   context, a source that is silent for good;
 * - seeks and new shows duck and unduck the worklet.
 *
 * Each test loads fresh modules: processing.ts keeps one context per page.
 */

let ios = false;
vi.mock("@/lib/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/lib/utils/platform")>()),
  isIOSDevice: () => ios,
}));

type Edge = [string, string];
let edges: Edge[];
let ctxs: FakeContext[];
let nodes: FakeWorkletNode[];
let addModule: { resolve: () => void; reject: (e: Error) => void } | null;
let sourcesMade: number;
let lastDelay: FakeDelay | null;
let gains: Record<string, FakeGain>;

class FakeParam {
  value: number;
  constructor(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
}
class FakeNode {
  constructor(public name: string) {}
  connect(to: FakeNode) {
    edges.push([this.name, to.name]);
    return to;
  }
}
class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}
class FakeDelay extends FakeNode {
  delayTime = new FakeParam(0);
}
class FakeAnalyser extends FakeNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
}
class FakeContext {
  state: "suspended" | "running" | "closed" = "running";
  sampleRate = 48000;
  currentTime = 0;
  destination = new FakeNode("destination");
  listeners: Array<() => void> = [];
  gains = 0;
  audioWorklet = {
    addModule: () =>
      new Promise<void>((resolve, reject) => {
        addModule = { resolve, reject };
      }),
  };
  constructor() {
    ctxs.push(this);
  }
  addEventListener(_t: string, fn: () => void) {
    this.listeners.push(fn);
  }
  resume() {
    return Promise.resolve();
  }
  setState(s: FakeContext["state"]) {
    this.state = s;
    for (const fn of this.listeners) fn();
  }
  createMediaElementSource() {
    sourcesMade++;
    return new FakeNode("source");
  }
  createAnalyser() {
    return new FakeAnalyser("analyser");
  }
  createGain() {
    // In route(): volume first, then wet, then dry.
    const g = new FakeGain(["volume", "wet", "dry"][this.gains++] ?? "gain");
    gains[g.name] = g;
    return g;
  }
  createDelay() {
    return (lastDelay = new FakeDelay("delay"));
  }
}
class FakeWorkletNode extends FakeNode {
  posted: Array<Record<string, unknown>> = [];
  port = {
    postMessage: (m: Record<string, unknown>) => this.posted.push(m),
    onmessage: null as null | ((e: { data: unknown }) => void),
  };
  onprocessorerror: null | (() => void) = null;
  constructor(
    _ctx: unknown,
    _name: string,
    public opts: { processorOptions: Record<string, unknown> },
  ) {
    super("worklet");
    nodes.push(this);
  }
  say(data: unknown) {
    this.port.onmessage?.({ data });
  }
}

const fetches: string[] = [];

async function load() {
  vi.resetModules();
  const engine = await import("@/audio/engine");
  const processing = await import("@/audio/processing");
  const { useProcessingStore } = await import("@/stores/processing-store");
  const { usePlayerStore } = await import("@/stores/player-store");
  const { useToastStore } = await import("@/stores/toast-store");
  const el = makeMediaElement();
  el.src = "https://archive.org/download/x/a.mp3";
  engine.initEngine(el);
  return { engine, processing, store: useProcessingStore, player: usePlayerStore, toasts: useToastStore, el };
}

/** Make the element audibly playing. */
function playing(el: HTMLAudioElement) {
  void el.play();
  setReadyState(el, 4);
}

async function flush() {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

beforeEach(() => {
  ios = false;
  edges = [];
  ctxs = [];
  nodes = [];
  addModule = null;
  sourcesMade = 0;
  lastDelay = null;
  gains = {};
  fetches.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal(
    "fetch",
    vi.fn((_u: string, init: { body: string }) => {
      fetches.push(JSON.parse(init.body).event);
      return Promise.resolve(new Response("{}"));
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("availability", () => {
  it("iOS: greyed, counted once, and no AudioContext is ever made", async () => {
    ios = true;
    const { processing, store, el } = await load();
    processing.startProcessing();
    playing(el);
    el.dispatchEvent(new Event("play"));
    expect(store.getState().availability).toBe("ios");
    expect(processing.processingAnalyser()).toBeNull();
    expect(ctxs).toHaveLength(0);
    expect(fetches).toEqual(["unavailable-ios"]);
  });

  it("no AudioWorklet: unsupported, nothing routed", async () => {
    vi.stubGlobal("AudioWorkletNode", undefined);
    const { processing, store } = await load();
    processing.startProcessing();
    expect(store.getState().availability).toBe("unsupported");
    expect(ctxs).toHaveLength(0);
  });
});

describe("counting", () => {
  it("a browser marked not counted sends nothing", async () => {
    localStorage.setItem("hd-not-counted", "1");
    const { processing } = await load();
    processing.startProcessing();
    processing.setCleanupSwitch(true);
    addModule!.reject(new Error("404"));
    await flush();
    expect(fetches).toEqual([]);
  });
});

describe("routing", () => {
  it("routes once the module is ready, with the wet and dry paths and the listener's volume after them", async () => {
    const { processing, store, el } = await load();
    processing.startProcessing();
    expect(ctxs).toHaveLength(1); // Level is on by default
    expect(sourcesMade).toBe(0); // module still loading: not yet
    addModule!.resolve();
    await flush();
    expect(store.getState().availability).toBe("ok");
    expect(sourcesMade).toBe(1);
    expect(edges).toEqual(
      expect.arrayContaining([
        ["source", "worklet"],
        ["worklet", "wet"],
        ["wet", "analyser"],
        ["source", "delay"],
        ["delay", "dry"],
        ["dry", "analyser"],
        ["analyser", "volume"],
        ["volume", "destination"],
      ]),
    );
    expect(nodes[0].opts.processorOptions).toMatchObject({ level: true, cleanup: false });
    // The worklet carries the sound; the dry path is silent until it is needed.
    expect(gains.wet.gain.value).toBe(1);
    expect(gains.dry.gain.value).toBe(0);
    expect(el.volume).toBe(1);
    // The slider moves the graph's volume, and element.volume stays at 1.
    processing.setProcessingVolume(0.4);
    expect(el.volume).toBe(1);
    expect(processing.processingAnalyser()).not.toBeNull();
  });

  it("never routes into a suspended context; routes when it starts running", async () => {
    const { processing } = await load();
    processing.startProcessing();
    ctxs[0].state = "suspended";
    addModule!.resolve();
    await flush();
    expect(sourcesMade).toBe(0);
    ctxs[0].setState("running");
    expect(sourcesMade).toBe(1);
  });

  it("both switches off and no visualizer: the element is never touched", async () => {
    localStorage.setItem("hd-dsp", JSON.stringify({ level: false, cleanup: false }));
    const { processing, el } = await load();
    processing.startProcessing();
    playing(el);
    el.dispatchEvent(new Event("play"));
    expect(ctxs).toHaveLength(0);
    expect(sourcesMade).toBe(0);
  });

  it("a switch turned on and off again before the module loaded: nothing is routed", async () => {
    localStorage.setItem("hd-dsp", JSON.stringify({ level: false, cleanup: false }));
    const { processing } = await load();
    processing.startProcessing();
    processing.setLevelSwitch(true); // the context is made, the module starts loading
    processing.setLevelSwitch(false);
    addModule!.resolve();
    await flush();
    expect(ctxs).toHaveLength(1);
    expect(sourcesMade).toBe(0);
  });

  it("the worklet's latency sets the dry path's delay", async () => {
    const { processing } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    nodes[0].say({ type: "ready", latency: 10869 });
    expect(lastDelay!.delayTime.value).toBeCloseTo(10869 / 48000, 9);
  });

  it("a switch flipped while playing is sent to the worklet", async () => {
    const { processing } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    processing.setCleanupSwitch(true);
    expect(nodes[0].posted).toContainEqual({ type: "set", level: true, cleanup: true });
    expect(fetches).toContain("cleanup-on");
  });

  it("routing mid-show fades the element out first, then ducks and unducks the worklet", async () => {
    localStorage.setItem("hd-dsp", JSON.stringify({ level: false, cleanup: false }));
    const { processing, el } = await load();
    processing.startProcessing();
    playing(el);
    processing.setLevelSwitch(true);
    addModule!.resolve();
    await flush();
    expect(sourcesMade).toBe(0); // fading
    vi.advanceTimersByTime(40);
    expect(sourcesMade).toBe(1);
    expect(nodes[0].posted.slice(0, 2)).toEqual([{ type: "duck" }, { type: "unduck", newShow: false }]);
    expect(el.volume).toBe(1);
  });
});

describe("failure is plain sound or a message, never silence", () => {
  it("module fails to load: greyed, counted, and the meters still get an analyser", async () => {
    const { processing, store } = await load();
    processing.startProcessing();
    addModule!.reject(new Error("404"));
    await flush();
    expect(store.getState().availability).toBe("failed");
    expect(fetches).toContain("fallback-load");
    expect(edges).toContainEqual(["source", "analyser"]);
    expect(nodes).toHaveLength(0);
  });

  it("processor error: the dry path takes over at once", async () => {
    const { processing, store } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    expect(gains.dry.gain.value).toBe(0);
    nodes[0].onprocessorerror!();
    expect(gains.wet.gain.value).toBe(0);
    expect(gains.dry.gain.value).toBe(1);
    expect(store.getState().availability).toBe("failed");
    expect(fetches).toContain("fallback-worklet");
  });

  it("a worklet that stops reporting while the show plays: the dry path", async () => {
    const { processing, store, el } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    playing(el);
    vi.advanceTimersByTime(3500);
    expect(store.getState().availability).toBe("failed");
    expect(fetches).toContain("fallback-worklet");
  });

  it("a context that will not run while the element plays: paused with a message", async () => {
    const { processing, el, toasts } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    playing(el);
    nodes[0].say({ type: "status", inPeak: 0.3 });
    ctxs[0].state = "suspended";
    vi.advanceTimersByTime(1000); // resume asked
    expect(el.paused).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(el.paused).toBe(true);
    expect(toasts.getState().toasts.map((t) => t.message)).toContain(processing.STALLED_MESSAGE);
    expect(fetches).toContain("fallback-stalled");
  });

  it("a few seconds of digital silence do not stop the show; 20 s of zero input with the playhead moving does", async () => {
    const { processing, el, store } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    playing(el);
    const at = (t: number) => {
      Object.defineProperty(el, "currentTime", { value: t, configurable: true, writable: true });
      nodes[0].say({ type: "status", inPeak: 0 });
    };
    for (let t = 100; t <= 108; t += 0.25) at(t);
    nodes[0].say({ type: "status", inPeak: 0.2 }); // the show speaks again
    expect(el.paused).toBe(false);
    for (let t = 200; t < 219.5; t += 0.25) at(t);
    expect(el.paused).toBe(false);
    for (let t = 219.5; t <= 220.5; t += 0.25) at(t);
    expect(el.paused).toBe(true);
    expect(store.getState().availability).toBe("failed");
    expect(fetches).toContain("fallback-silent");
  });
});

describe("seeks and new shows", () => {
  it("a seek ducks and unducks; a new show unducks as new and is counted", async () => {
    const { processing, el, player } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    const w = nodes[0];
    w.posted.length = 0;
    el.dispatchEvent(new Event("seeking"));
    el.dispatchEvent(new Event("seeked"));
    expect(w.posted).toEqual([{ type: "duck" }, { type: "unduck", newShow: false }]);
    w.posted.length = 0;
    player.setState({ currentEpisode: { fileHash: "archive:x:b.mp3" } as never });
    el.dispatchEvent(new Event("loadstart"));
    el.dispatchEvent(new Event("seeked")); // a restore seek before it plays: still ducked
    el.dispatchEvent(new Event("playing"));
    expect(w.posted).toEqual([{ type: "duck" }, { type: "unduck", newShow: true, startGainDb: processing.START_GAIN_DB }]);
    expect(fetches).toContain("play-level");
  });
});
