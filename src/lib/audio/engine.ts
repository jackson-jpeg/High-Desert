/**
 * Audio Engine
 *
 * Audio plays natively through HTMLAudioElement — this survives iOS lock
 * screen, background tabs, and AudioContext suspension.
 *
 * For the oscilloscope visualization, we optionally create an AudioContext
 * and tap into the element via captureStream(). This doesn't capture or
 * redirect the audio output — it just gives us analyser data. If
 * captureStream() isn't supported (Safari/iOS), the oscilloscope shows
 * the idle breathing animation and audio still plays fine.
 */

let mediaElement: HTMLAudioElement | null = null;
let audioContext: AudioContext | null = null;
let analyserNode: AnalyserNode | null = null;
let streamSource: MediaStreamAudioSourceNode | null = null;
let lastSrc = "";

export function getAnalyserNode(): AnalyserNode | null {
  // Re-init if source changed (new episode loaded)
  if (mediaElement && mediaElement.src !== lastSrc) {
    lastSrc = mediaElement.src;
    cleanupAnalyser();
  }

  // Lazy init: try when we don't have an analyser and audio is playing
  if (!analyserNode && mediaElement?.src && !mediaElement.paused) {
    tryInitAnalyser();
  }
  return analyserNode;
}

/**
 * Notify the engine that the audio source has changed.
 * Resets the analyser so it can re-attach to the new stream.
 */
export function notifySourceChanged(): void {
  cleanupAnalyser();
}

export function getMediaElement(): HTMLAudioElement | null {
  return mediaElement;
}

export function initEngine(audio: HTMLAudioElement): void {
  if (mediaElement === audio) return;

  // Clean up previous analyser
  cleanupAnalyser();

  mediaElement = audio;
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
 * Uses captureStream() so audio continues to play natively.
 */
function tryInitAnalyser(): void {
  if (analyserNode || !mediaElement) return;

  try {
    // captureStream() gives us a MediaStream copy without redirecting output
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream = (mediaElement as any).captureStream?.() as MediaStream | undefined;
    if (!stream || stream.getAudioTracks().length === 0) return;

    audioContext = new AudioContext();
    // Resume in case created outside a user gesture
    if (audioContext.state === "suspended") {
      audioContext.resume().catch(() => {});
    }
    streamSource = audioContext.createMediaStreamSource(stream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    // source -> analyser only (no destination — we're just reading data)
    streamSource.connect(analyserNode);
  } catch {
    // captureStream not supported (Safari) or CORS restriction — that's fine,
    // oscilloscope shows the idle breathing animation
    analyserNode = null;
  }
}

function cleanupAnalyser(): void {
  try { streamSource?.disconnect(); } catch { /* ignore */ }
  try { audioContext?.close(); } catch { /* ignore */ }
  streamSource = null;
  analyserNode = null;
  audioContext = null;
  lastSrc = "";
}
