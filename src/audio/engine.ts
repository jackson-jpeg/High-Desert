/**
 * Audio Engine
 *
 * Audio plays natively through HTMLAudioElement — this survives iOS lock
 * screen, background tabs, and AudioContext suspension.
 *
 * For the oscilloscope visualization, we create an AudioContext and route
 * the media element through createMediaElementSource(). This gives us
 * real waveform data via an AnalyserNode. The audio is connected:
 *   mediaElement → source → analyser → destination
 * so playback continues normally through speakers.
 *
 * createMediaElementSource() can only be called ONCE per element, so we
 * guard with `elementConnected` and never tear down the graph.
 */

let mediaElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let elementConnected = false;

/**
 * Detect iOS/iPadOS — createMediaElementSource routes audio through
 * AudioContext which iOS suspends on lock screen, killing playback.
 * We skip the analyser entirely on these devices.
 */
function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function getAnalyserNode(): AnalyserNode | null {
  // Lazy init: try when we don't have an analyser and audio is playing
  if (!analyserNode && mediaElement?.src && !mediaElement.paused) {
    tryInitAnalyser();
  }
  return analyserNode;
}

/**
 * Notify the engine that the audio source has changed.
 * With createMediaElementSource the connection persists across src changes,
 * so this is now a no-op but kept for API compatibility.
 */
export function notifySourceChanged(): void {
  // No-op — createMediaElementSource persists across src changes
}

export function getMediaElement(): HTMLAudioElement | null {
  return mediaElement;
}

export function initEngine(audio: HTMLAudioElement): void {
  if (mediaElement === audio) return;

  mediaElement = audio;
  // Reset connection flag only if we get a brand new element
  if (!elementConnected) {
    analyserNode = null;
    audioContext = null;
  }
}

export function setEngineVolume(volume: number): void {
  if (mediaElement) {
    mediaElement.volume = volume;
  }
}

/**
 * Resume the analyser AudioContext (for oscilloscope).
 * Not required for audio playback — the element plays natively.
 */
export function resumeContext(): Promise<void> {
  if (audioContext?.state === "suspended") {
    return audioContext.resume();
  }
  return Promise.resolve();
}

/**
 * Try to create an AnalyserNode for oscilloscope visualization.
 * Uses createMediaElementSource() to route audio through Web Audio API.
 * Can only be called once per media element.
 */
function tryInitAnalyser(): void {
  if (analyserNode || !mediaElement || elementConnected) return;
  // Never route through AudioContext on iOS — it kills background playback
  if (isIOSDevice()) return;

  try {
    audioContext = new AudioContext();
    const source = audioContext.createMediaElementSource(mediaElement);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    source.connect(analyserNode);
    analyserNode.connect(audioContext.destination); // MUST connect or no audio!
    elementConnected = true;

    // Resume in case created outside a user gesture
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
  } catch {
    // createMediaElementSource not supported or CORS issue — that's fine,
    // oscilloscope shows the idle breathing animation
    analyserNode = null;
  }
}

// cleanupAnalyser removed — createMediaElementSource graph is permanently bound
