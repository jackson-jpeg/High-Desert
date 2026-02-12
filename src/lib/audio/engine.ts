/**
 * Audio Engine
 *
 * AudioContext -> MediaElementSource -> GainNode -> AnalyserNode -> destination
 *
 * Provides play/pause/seek/volume control and exposes the AnalyserNode
 * for oscilloscope visualization.
 */

let audioContext: AudioContext | null = null;
let mediaElement: HTMLAudioElement | null = null;
let sourceNode: MediaElementAudioSourceNode | null = null;
let gainNode: GainNode | null = null;
let analyserNode: AnalyserNode | null = null;

function ensureContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function getAnalyserNode(): AnalyserNode | null {
  return analyserNode;
}

export function getMediaElement(): HTMLAudioElement | null {
  return mediaElement;
}

export function initEngine(audio: HTMLAudioElement): void {
  const ctx = ensureContext();

  // Avoid double-connecting the same element
  if (mediaElement === audio && sourceNode) return;

  // Clean up previous connections
  if (sourceNode) {
    try {
      sourceNode.disconnect();
    } catch {
      // ignore
    }
  }

  mediaElement = audio;

  // Set crossOrigin for remote URLs (must be set before createMediaElementSource)
  audio.crossOrigin = "anonymous";

  // Create nodes
  sourceNode = ctx.createMediaElementSource(audio);
  gainNode = ctx.createGain();
  analyserNode = ctx.createAnalyser();

  // Configure analyser for smooth oscilloscope
  analyserNode.fftSize = 2048;
  analyserNode.smoothingTimeConstant = 0.8;

  // Wire: source -> gain -> analyser -> destination
  sourceNode.connect(gainNode);
  gainNode.connect(analyserNode);
  analyserNode.connect(ctx.destination);
}

export function setEngineVolume(volume: number): void {
  if (gainNode && audioContext) {
    gainNode.gain.setValueAtTime(volume, audioContext.currentTime);
  }
}

export function resumeContext(): Promise<void> {
  if (audioContext && audioContext.state === "suspended") {
    return audioContext.resume();
  }
  return Promise.resolve();
}
