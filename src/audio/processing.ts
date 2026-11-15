/**
 * Level and Clean up in the browser (docs/audio-processing/README.md): the
 * one AudioContext, the graph the player's element is routed through, and
 * everything that keeps it from ever playing silence.
 *
 *   element ─ source ─┬─ worklet (Clean up, Level) ─ wet ─┐
 *                     └─ delay (the worklet's latency) ─ dry ┴─ analyser ─ volume ─ speakers
 *
 * - The worklet carries the sound; the dry path is the same audio, delayed by
 *   exactly the worklet's latency, at zero gain. If the worklet fails, the
 *   dry path takes over with no jump in time (`toDry`).
 * - The listener's volume is the `volume` node, after the processing:
 *   element.volume is held at 1 once routed, or Level would undo the slider.
 * - The analyser is after the processing, before the volume: the meters show
 *   what is heard, at a fixed reference. It is the one every visualizer reads
 *   on desktop and Android (engine.getAnalyserNode()).
 * - iOS: nothing is routed, ever (Web Audio stops a show on the lock screen;
 *   engine.ts, levels.ts). The switches are greyed with a one-line reason.
 *
 * When is the element routed? Only into a context that is *running* (a
 * suspended one is silence), and only once the worklet module has loaded or
 * failed. The context is created as soon as either switch is on (or a
 * visualizer asks), suspended if there has been no gesture yet, and resumed
 * on the next tap or key press anywhere: creating it in an animation frame,
 * outside any gesture, is what left Safari's meters flat. If the element is
 * already playing when routing becomes possible, its own output is faded out
 * first and the worklet fades in after its latency: one dip of about a
 * quarter second, once per page at most.
 *
 * The liveness watch (every second while routed): the element is playing but
 * the context is not running → resume; still not after 2.5 s → pause, with a
 * message, never silence (`fallback-stalled`). The context runs but the
 * worklet has gone quiet for 2 s, or threw → the dry path (`fallback-worklet`).
 * A cross-origin source whose input has been exactly zero from its first
 * second, for 20 s of playhead while it plays (a source the browser refuses
 * to expose; crossOrigin is set on the element, so this is a backstop) →
 * pause, with a message, and never route again in this session
 * (`fallback-silent`). Real silence never trips it: a source that has made
 * one sound is exposed, and a same-origin source (/mirror, the e2e stack's
 * silent show) cannot be refused.
 */
import { getMediaElement, isBridging, onEngineEvent } from "@/audio/engine";
import { isIOSDevice } from "@/lib/utils/platform";
import { pageBuild } from "@/lib/utils/build-id";
import type { DspEvent } from "@/lib/audio/dsp-events";
import { notCounted } from "@/services/stats/not-counted";
import { usePlayerStore } from "@/stores/player-store";
import { useProcessingStore, type DspAvailability } from "@/stores/processing-store";
import { toast } from "@/stores/toast-store";

export const WORKLET_PATH = "/audio/dsp-worklet.js";
export const PROCESSOR_NAME = "hd-dsp";
/**
 * Where Level starts a new show, dB. The archive's median loudness as played
 * is about -19.4 LUFS (docs/audio-processing/archive-survey.csv), so a new
 * show starts a little under the gain it will probably settle at, and rises.
 */
export const START_GAIN_DB = 2;
const LIVENESS_MS = 1000;
const STALL_MS = 2500;
const WORKLET_QUIET_MS = 2000;
/**
 * Exact-zero input for this long, while the playhead moves, before the source
 * is judged refused. Long on purpose: an MP3 of digital silence decodes to
 * exact zeros, and a few seconds of dead air must never stop a show. A
 * refused source is zero for ever, so waiting costs only seconds once.
 */
const SILENT_SOURCE_SEC = 20;
const FADE_OUT_MS = 30;

export const STALLED_MESSAGE = "Sound was interrupted. Press play to continue.";
export const SILENT_MESSAGE = "The browser blocked this show's sound. Try another show, or reload the page.";

type ModuleState = "idle" | "loading" | "ready" | "failed";

interface Graph {
  source: MediaElementAudioSourceNode;
  analyser: AnalyserNode;
  volume: GainNode;
  node: AudioWorkletNode | null;
  wet: GainNode | null;
  dry: GainNode | null;
  delay: DelayNode | null;
}

let ctx: AudioContext | null = null;
let moduleState: ModuleState = "idle";
let graph: Graph | null = null;
let routing = false;
let started = false;
let wantAnalyser = false;
let onDry = false;
let neverRoute = false;
let lastStatusAt = 0;
/** The playhead when the input went exactly silent, or null. */
let silentFrom: number | null = null;
/** The current source has given the worklet a non-zero sample: it is exposed, whatever follows. */
let heardSource = false;
let stalledSince: number | null = null;
let pendingNewSource = false;
let lastShowKey: string | null = null;
let watch: ReturnType<typeof setInterval> | null = null;
let volumeLevel = 1;

/** What this device can do, decided once. */
export function deviceAvailability(): Exclude<DspAvailability, "pending" | "failed"> {
  if (typeof window === "undefined") return "unsupported";
  if (isIOSDevice()) return "ios";
  const w = window as unknown as { AudioContext?: unknown; AudioWorkletNode?: unknown };
  if (typeof w.AudioContext !== "function" || typeof w.AudioWorkletNode !== "function") return "unsupported";
  return "ok";
}

// ── Counters (src/lib/audio/dsp-events.ts) ──

const ONCE_KEY = "hd-dsp-once";

export function countDsp(event: DspEvent, oncePerSession = false): void {
  if (typeof window === "undefined" || notCounted()) return;
  if (oncePerSession) {
    try {
      const seen = new Set((sessionStorage.getItem(ONCE_KEY) ?? "").split(",").filter(Boolean));
      if (seen.has(event)) return;
      seen.add(event);
      sessionStorage.setItem(ONCE_KEY, [...seen].join(","));
    } catch {
      // No session storage: counted, possibly more than once.
    }
  }
  try {
    void fetch("/api/stats/dsp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Counting never breaks playback.
  }
}

// ── The switches, from the UI ──

export function setLevelSwitch(on: boolean): void {
  const s = useProcessingStore.getState();
  if (s.level === on) return;
  s.setLevel(on);
  countDsp(on ? "level-on" : "level-off");
  // A tap is a gesture: the moment to create or resume the context.
  if (on) ensureContext(true);
}

export function setCleanupSwitch(on: boolean): void {
  const s = useProcessingStore.getState();
  if (s.cleanup === on) return;
  s.setCleanup(on);
  countDsp(on ? "cleanup-on" : "cleanup-off");
  if (on) ensureContext(true);
}

function switchesOn(): boolean {
  const s = useProcessingStore.getState();
  return s.availability !== "ios" && s.availability !== "unsupported" && (s.level || s.cleanup);
}

// ── Context and module ──

function ensureContext(inGesture = false): AudioContext | null {
  if (neverRoute || deviceAvailability() !== "ok") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext({ latencyHint: "playback" });
    } catch {
      useProcessingStore.getState().setAvailability("unsupported");
      return null;
    }
    ctx.addEventListener("statechange", () => maybeRoute());
    loadModule(ctx);
  }
  if (inGesture && ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => {});
  return ctx;
}

function loadModule(c: AudioContext): void {
  if (moduleState !== "idle") return;
  moduleState = "loading";
  const build = pageBuild();
  const url = build ? `${WORKLET_PATH}?v=${build}` : WORKLET_PATH;
  c.audioWorklet
    .addModule(url)
    .then(() => {
      moduleState = "ready";
      if (useProcessingStore.getState().availability === "pending") useProcessingStore.getState().setAvailability("ok");
      maybeRoute();
    })
    .catch(() => {
      moduleState = "failed";
      useProcessingStore.getState().setAvailability("failed");
      countDsp("fallback-load", true);
      maybeRoute();
    });
}

/** Resume on any tap or key: the one sure way out of "suspended" everywhere. */
function installGestureResume(): void {
  const resume = () => {
    if (!ctx && switchesOn()) ensureContext(true);
    else if (ctx && ctx.state !== "running" && ctx.state !== "closed") ctx.resume().catch(() => {});
  };
  for (const type of ["pointerdown", "keydown", "touchend"]) window.addEventListener(type, resume, { capture: true, passive: true });
}

// ── Routing ──

/** A source from another origin: the only kind a browser could refuse to expose to Web Audio. */
function crossOrigin(el: HTMLMediaElement): boolean {
  try {
    return new URL(el.currentSrc || el.src, location.href).origin !== location.origin;
  } catch {
    return false;
  }
}

function audible(el: HTMLMediaElement): boolean {
  return !el.paused && !el.ended && el.readyState >= 3;
}

function maybeRoute(): void {
  if (graph || routing || neverRoute) return;
  const el = getMediaElement();
  if (!el || !ctx || ctx.state !== "running") return;
  if (moduleState === "loading" || moduleState === "idle") return;
  if (!(switchesOn() || wantAnalyser)) return;
  routing = true;
  if (audible(el)) fadeElementOut(el, () => route(el, true));
  else route(el, false);
}

function fadeElementOut(el: HTMLMediaElement, then: () => void): void {
  const from = el.volume;
  const steps = 6;
  let i = 0;
  const t = setInterval(() => {
    i++;
    el.volume = Math.max(0, from * (1 - i / steps));
    if (i >= steps) {
      clearInterval(t);
      then();
    }
  }, FADE_OUT_MS / steps);
}

function route(el: HTMLMediaElement, midPlay: boolean): void {
  const c = ctx!;
  try {
    const source = c.createMediaElementSource(el);
    const analyser = c.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.8;
    const volume = c.createGain();
    volume.gain.value = volumeLevel;
    analyser.connect(volume);
    volume.connect(c.destination);
    const g: Graph = { source, analyser, volume, node: null, wet: null, dry: null, delay: null };
    if (moduleState === "ready") {
      const s = useProcessingStore.getState();
      const node = new AudioWorkletNode(c, PROCESSOR_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
        processorOptions: { level: s.level, cleanup: s.cleanup, startGainDb: START_GAIN_DB },
      });
      const wet = c.createGain();
      const dry = c.createGain();
      dry.gain.value = 0;
      const delay = c.createDelay(1);
      source.connect(node);
      node.connect(wet);
      wet.connect(analyser);
      source.connect(delay);
      delay.connect(dry);
      dry.connect(analyser);
      node.port.onmessage = (e: MessageEvent) => onWorkletMessage(e.data, delay, c.sampleRate);
      node.onprocessorerror = () => toDry("fallback-worklet");
      Object.assign(g, { node, wet, dry, delay });
      lastStatusAt = performance.now();
      if (midPlay) {
        // The element's own output was just faded out; the worklet comes in
        // after its latency, faded, instead of mid-word.
        node.port.postMessage({ type: "duck" });
        node.port.postMessage({ type: "unduck", newShow: false });
      }
    } else {
      // No processor (it failed to load): the analyser alone, as before.
      source.connect(analyser);
      if (midPlay) {
        volume.gain.value = 0;
        volume.gain.setTargetAtTime(volumeLevel, c.currentTime, 0.015);
      }
    }
    el.volume = 1;
    graph = g;
    lastShowKey = showKey();
    installElementEvents();
    if (!watch) watch = setInterval(liveness, LIVENESS_MS);
  } catch {
    // createMediaElementSource refused (already taken, or not allowed): the
    // element keeps playing natively, untouched.
    el.volume = volumeLevel;
    neverRoute = true;
    if (switchesOn()) useProcessingStore.getState().setAvailability("failed");
  } finally {
    routing = false;
  }
}

function onWorkletMessage(m: { type?: string; latency?: number; inPeak?: number; level?: { gainDb: number; mix: number }; cleanup?: { mix: number; music: number; humLines: number } }, delay: DelayNode, rate: number): void {
  if (m?.type === "ready" && typeof m.latency === "number") {
    delay.delayTime.value = m.latency / rate;
    return;
  }
  if (m?.type !== "status") return;
  lastStatusAt = performance.now();
  const el = getMediaElement();
  if (typeof m.inPeak === "number" && m.inPeak > 0 && el && !isBridging()) heardSource = true;
  if (el && audible(el) && !isBridging() && m.inPeak === 0 && !heardSource && crossOrigin(el)) {
    if (silentFrom === null || el.currentTime < silentFrom) silentFrom = el.currentTime;
    else if (el.currentTime - silentFrom >= SILENT_SOURCE_SEC) silentSource();
  } else silentFrom = null;
  if (m.level && m.cleanup) {
    useProcessingStore.getState().setMeter({
      gainDb: m.level.gainDb,
      levelMix: m.level.mix,
      music: m.cleanup.music,
      humLines: m.cleanup.humLines,
      cleanupMix: m.cleanup.mix,
    });
  }
}

function toDry(event: DspEvent): void {
  if (!graph?.node || onDry) return;
  onDry = true;
  const c = ctx!;
  graph.wet!.gain.setTargetAtTime(0, c.currentTime, 0.008);
  graph.dry!.gain.setTargetAtTime(1, c.currentTime, 0.008);
  useProcessingStore.getState().setAvailability("failed");
  useProcessingStore.getState().setMeter(null);
  countDsp(event);
}

function silentSource(): void {
  silentFrom = null;
  const el = getMediaElement();
  el?.pause();
  neverRoute = true;
  useProcessingStore.getState().setAvailability("failed");
  countDsp("fallback-silent");
  toast.error(SILENT_MESSAGE);
}

function liveness(): void {
  const el = getMediaElement();
  if (!el || !graph || !ctx) return;
  if (!audible(el)) {
    stalledSince = null;
    return;
  }
  const now = performance.now();
  if (ctx.state !== "running") {
    if (stalledSince === null) {
      stalledSince = now;
      ctx.resume().catch(() => {});
    } else if (now - stalledSince > STALL_MS) {
      stalledSince = null;
      el.pause();
      countDsp("fallback-stalled");
      toast.error(STALLED_MESSAGE);
    }
    return;
  }
  stalledSince = null;
  if (graph.node && !onDry && now - lastStatusAt > WORKLET_QUIET_MS) toDry("fallback-worklet");
}

// ── Seeks and new sources: duck, then unduck ──

function showKey(): string {
  if (isBridging()) return "bridge";
  return usePlayerStore.getState().currentEpisode?.fileHash ?? getMediaElement()?.src ?? "";
}

let eventsInstalled = false;

function post(m: object): void {
  if (graph?.node && !onDry) graph.node.port.postMessage(m);
}

function installElementEvents(): void {
  if (eventsInstalled) return;
  eventsInstalled = true;
  onEngineEvent("seeking", () => post({ type: "duck" }));
  onEngineEvent("seeked", () => {
    if (!pendingNewSource) post({ type: "unduck", newShow: false });
  });
  onEngineEvent("loadstart", () => {
    pendingNewSource = true;
    heardSource = false;
    silentFrom = null;
    post({ type: "duck" });
  });
  onEngineEvent("playing", () => {
    if (!pendingNewSource) return;
    pendingNewSource = false;
    const key = showKey();
    const newShow = key !== lastShowKey;
    lastShowKey = key;
    post({ type: "unduck", newShow, startGainDb: START_GAIN_DB });
    if (newShow && key !== "bridge") countPlay();
  });
}

function countPlay(): void {
  const s = useProcessingStore.getState();
  if (s.availability !== "ok") return;
  if (s.level) countDsp("play-level");
  if (s.cleanup) countDsp("play-cleanup");
  if (!s.level && !s.cleanup) countDsp("play-plain");
}

// ── For the engine ──

/** The analyser every visualizer reads on desktop and Android; null until routed. */
export function processingAnalyser(): AnalyserNode | null {
  if (graph) return graph.analyser;
  if (typeof window === "undefined" || isIOSDevice() || neverRoute) return null;
  if (!wantAnalyser) {
    wantAnalyser = true;
    ensureContext();
  }
  maybeRoute();
  return null;
}

/** Set the listener's volume. True when the graph has it (element.volume stays 1). */
export function setProcessingVolume(v: number): boolean {
  volumeLevel = v;
  if (!graph || !ctx) return false;
  graph.volume.gain.setTargetAtTime(v, ctx.currentTime, 0.01);
  return true;
}

/** Called from the play paths after play(): resume if the context needs it. */
export function resumeProcessing(): Promise<void> {
  if (ctx && ctx.state !== "running" && ctx.state !== "closed") return ctx.resume().catch(() => {});
  return Promise.resolve();
}

/** Once, from the desktop layout: decide availability, read the switches, get ready. */
export function startProcessing(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  const store = useProcessingStore.getState();
  store.hydrate();
  const dev = deviceAvailability();
  if (dev !== "ok") {
    store.setAvailability(dev);
    countDsp(dev === "ios" ? "unavailable-ios" : "unavailable-unsupported", true);
    return;
  }
  installGestureResume();
  onEngineEvent("play", () => {
    if (switchesOn()) ensureContext();
    resumeProcessing();
    maybeRoute();
  });
  useProcessingStore.subscribe((s, prev) => {
    if (s.level !== prev.level || s.cleanup !== prev.cleanup) {
      post({ type: "set", level: s.level, cleanup: s.cleanup });
      if (s.level || s.cleanup) maybeRoute();
    }
  });
  if (switchesOn()) ensureContext();
}

/** Test-only: forget everything. */
export function __resetProcessingForTests(): void {
  if (watch) clearInterval(watch);
  ctx = null;
  moduleState = "idle";
  graph = null;
  routing = started = wantAnalyser = onDry = neverRoute = eventsInstalled = pendingNewSource = false;
  lastStatusAt = 0;
  silentFrom = null;
  heardSource = false;
  stalledSince = null;
  lastShowKey = null;
  watch = null;
  volumeLevel = 1;
}
