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
 * - seeks and new shows duck and unduck the worklet;
 * - two-pass Level: a show with an envelope drives the envelope gain from
 *   the element's position and the worklet's AGC steps aside; a show without
 *   one keeps the live leveler.
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
  calls: [string, number, number?][] = [];
  constructor(v: number) {
    this.value = v;
  }
  setTargetAtTime(v: number) {
    this.value = v;
  }
  cancelScheduledValues(t: number) {
    this.calls.push(["cancel", t]);
  }
  setValueAtTime(v: number, t: number) {
    this.value = v;
    this.calls.push(["set", v, t]);
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.calls.push(["ramp", v, t]);
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
    // In route(): volume first, then wet, dry, and the envelope gain.
    const g = new FakeGain(["volume", "wet", "dry", "env"][this.gains++] ?? "gain");
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
/** Envelope responses by community key (absent: 404, no envelope yet). */
let envelopes: Record<string, Uint8Array>;
const envelopeGets: string[] = [];

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
  envelopes = {};
  envelopeGets.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  vi.useFakeTimers();
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal("AudioWorkletNode", FakeWorkletNode);
  vi.stubGlobal(
    "fetch",
    vi.fn((u: string, init?: { body: string }) => {
      if (u.startsWith("/api/level/envelope")) {
        const key = decodeURIComponent(u.split("key=")[1]);
        envelopeGets.push(key);
        const body = envelopes[key];
        return Promise.resolve(body ? new Response(body.slice()) : new Response("{}", { status: 404 }));
      }
      fetches.push(JSON.parse(init!.body).event);
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
        ["source", "env"],
        ["env", "worklet"],
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
    localStorage.setItem("hd-dsp-preview", "cleanup");
    const { processing } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    processing.setCleanupSwitch(true);
    expect(nodes[0].posted).toContainEqual({ type: "set", level: true, cleanup: true });
    expect(fetches).toContain("cleanup-on");
  });

  it("Clean up held back: its switch does nothing and a saved choice never runs it", async () => {
    localStorage.setItem("hd-dsp", JSON.stringify({ level: true, cleanup: true }));
    const { processing, store } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    expect(nodes[0].opts.processorOptions).toMatchObject({ level: true, cleanup: false });
    processing.setCleanupSwitch(true);
    expect(store.getState().cleanup).toBe(false);
    expect(nodes[0].posted).not.toContainEqual(expect.objectContaining({ cleanup: true }));
    expect(fetches).not.toContain("cleanup-on");
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

  it("a source refused from its first second stops after 20 s of playhead; a few seconds do not", async () => {
    const { processing, el, store } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    playing(el);
    const at = (t: number) => {
      Object.defineProperty(el, "currentTime", { value: t, configurable: true, writable: true });
      nodes[0].say({ type: "status", inPeak: 0 });
    };
    for (let t = 100; t < 119.5; t += 0.25) at(t);
    expect(el.paused).toBe(false);
    for (let t = 119.5; t <= 120.5; t += 0.25) at(t);
    expect(el.paused).toBe(true);
    expect(store.getState().availability).toBe("failed");
    expect(fetches).toContain("fallback-silent");
  });

  it("real silence never stops the show: once the source has made a sound, or from this origin", async () => {
    const { processing, el, store } = await load();
    processing.startProcessing();
    addModule!.resolve();
    await flush();
    playing(el);
    const at = (t: number) => {
      Object.defineProperty(el, "currentTime", { value: t, configurable: true, writable: true });
      nodes[0].say({ type: "status", inPeak: 0 });
    };
    nodes[0].say({ type: "status", inPeak: 0.2 }); // the show speaks
    for (let t = 100; t <= 160; t += 0.25) at(t); // then a minute of dead air
    expect(el.paused).toBe(false);
    // A new source starts unheard: the mirror, same origin, silent throughout.
    el.src = `${location.origin}/mirror/archive%3Ax%3Aa.mp3`;
    el.dispatchEvent(new Event("loadstart"));
    el.dispatchEvent(new Event("playing"));
    for (let t = 0; t <= 60; t += 0.25) at(t);
    expect(el.paused).toBe(false);
    expect(store.getState().availability).toBe("ok");
    expect(fetches).not.toContain("fallback-silent");
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

describe("two-pass Level", () => {
  // 0 dB, then +2, +4 ... at 0.2, 0.3, 0.4 ... s (int8, 0.25 dB steps)
  const KEY = "x--a";
  const episode = { fileHash: "archive:x:a.mp3", archiveIdentifier: "x", fileName: "a.mp3" } as never;
  const lin = (db: number) => Math.pow(10, db / 20);

  async function routed(withEnvelope: boolean) {
    const { packEnvelope } = await import("@/lib/audio/level-envelope");
    if (withEnvelope) envelopes[KEY] = packEnvelope(Int8Array.from({ length: 600 }, (_, i) => Math.min(48, i * 8)));
    const t = await load();
    t.player.setState({ currentEpisode: episode });
    t.processing.startProcessing();
    addModule!.resolve();
    await flush();
    // The envelope's body is read through Response.arrayBuffer: a few ticks.
    for (let i = 0; i < 3; i++) await vi.advanceTimersByTimeAsync(0);
    await flush();
    return t;
  }

  it("a show with an envelope: fetched, the worklet's AGC steps aside, the gain follows the element", async () => {
    const { el } = await routed(true);
    expect(envelopeGets).toEqual([KEY]);
    expect(nodes[0].posted).toContainEqual({ type: "envelope", on: true, now: true });
    playing(el);
    el.currentTime = 0.4;
    ctxs[0].currentTime = 5;
    const p = gains.env.gain;
    p.calls.length = 0;
    el.dispatchEvent(new Event("timeupdate"));
    // The gain at 0.4 s is +4 dB, set now; then a ramp per later point.
    expect(p.calls[0]).toEqual(["cancel", 5]);
    expect(p.calls[1][1]).toBeCloseTo(lin(4), 9);
    const ramps = p.calls.filter((c) => c[0] === "ramp");
    expect(ramps[0][1]).toBeCloseTo(lin(6), 9);
    expect(ramps[0][2]).toBeCloseTo(5.1, 9);
  });

  it("the meter says which: envelope", async () => {
    const { store } = await routed(true);
    nodes[0].say({ type: "status", inPeak: 0.1, level: { gainDb: 3, mix: 1 }, cleanup: { mix: 0, music: 0, humLines: 0 } });
    expect(store.getState().meter?.levelSource).toBe("envelope");
  });

  it("a show with no envelope yet: the live leveler, nothing scheduled", async () => {
    const { el, store } = await routed(false);
    expect(envelopeGets).toEqual([KEY]);
    expect(nodes[0].posted).not.toContainEqual(expect.objectContaining({ type: "envelope" }));
    playing(el);
    el.dispatchEvent(new Event("timeupdate"));
    expect(gains.env.gain.calls).toEqual([]);
    expect(gains.env.gain.value).toBe(1);
    nodes[0].say({ type: "status", inPeak: 0.1, level: { gainDb: 3, mix: 1 }, cleanup: { mix: 0, music: 0, humLines: 0 } });
    expect(store.getState().meter?.levelSource).toBe("live");
  });

  it("a seek lays the schedule again from the new position", async () => {
    const { el } = await routed(true);
    playing(el);
    el.currentTime = 2.2; // frame 20: +40 dB, clamped by the int8 data at +12
    const p = gains.env.gain;
    p.calls.length = 0;
    el.dispatchEvent(new Event("seeking"));
    el.dispatchEvent(new Event("seeked"));
    expect(p.calls[1][1]).toBeCloseTo(lin(12), 9);
  });

  it("Level switched off: the worklet takes the gain back and the envelope gain returns to unity", async () => {
    const { processing, el } = await routed(true);
    playing(el);
    nodes[0].posted.length = 0;
    processing.setLevelSwitch(false);
    expect(nodes[0].posted).toContainEqual({ type: "envelope", on: false, now: false });
    const last = gains.env.gain.calls[gains.env.gain.calls.length - 1];
    expect(last[0]).toBe("ramp");
    expect(last[1]).toBe(1);
  });

  it("a local file has no key: never fetched, the live leveler", async () => {
    const t = await load();
    t.player.setState({ currentEpisode: { fileHash: "local:abc", fileName: "a.mp3" } as never });
    t.processing.startProcessing();
    addModule!.resolve();
    await flush();
    expect(envelopeGets).toEqual([]);
  });
});
