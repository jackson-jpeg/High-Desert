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
 * Validate audio file format compatibility before playback.
 * Currently supports MP3 format for archive.org sources.
 */
export function validateAudioFormat(src: string): boolean {
  if (!src) return false;
  
  try {
    // Check URL validity
    const url = new URL(src);
    
    // Ensure protocol is http/https
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    
    // Check file extension
    const pathname = url.pathname.toLowerCase();
    
    // Support MP3 and common variants
    const supportedExtensions = ['.mp3', '.mpga', '.mpeg'];
    return supportedExtensions.some(ext => pathname.endsWith(ext));
  } catch {
    // Invalid URL format
    return false;
  }
}

/**
 * Resume the analyser AudioContext (for oscilloscope).
 * Not required for audio playback — the element plays natively.
 */
export function resumeContext(): Promise<void> {
  if (!audioContext) {
    console.warn("[engine] Cannot resume: AudioContext not initialized");
    return Promise.resolve();
  }
  
  if (audioContext.state === "suspended") {
    return audioContext.resume().catch((err) => {
      console.error("[engine] Failed to resume AudioContext:", err);
      // Reset state on resume failure
      analyserNode = null;
      audioContext = null;
      elementConnected = false;
      throw err; // Re-throw for caller to handle
    });
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
    if (typeof AudioContext === 'undefined') {
      console.warn("[engine] Web Audio API not supported");
      return;
    }
    
    try {
      audioContext = new AudioContext();
    } catch (error) {
      console.warn("[engine] Failed to create AudioContext:", error);
      return;
    }
    if (!audioContext) {
      console.warn("[engine] Failed to create AudioContext");
      return;
    }
    
    // Handle autoplay policy errors
    if (audioContext.state === "suspended") {
      console.log("[engine] AudioContext suspended, waiting for user interaction");
    }
    
    const source = audioContext.createMediaElementSource(mediaElement);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    source.connect(analyserNode);
    analyserNode.connect(audioContext.destination); // MUST connect or no audio!
    elementConnected = true;

    // Resume in case created outside a user gesture
    if (audioContext.state === "suspended") {
      audioContext.resume().catch((err) => { 
        console.warn("[engine] Failed to resume AudioContext (autoplay policy):", err);
        // Clean up on autoplay failure
        analyserNode = null;
        audioContext = null;
        elementConnected = false;
      });
    }
  } catch (error) {
    console.error("[engine] Web Audio API initialization failed:", error);
    // createMediaElementSource not supported or CORS issue — that's fine,
    // oscilloscope shows the idle breathing animation
    analyserNode = null;
    audioContext = null;
    elementConnected = false;
  }
}

// cleanupAnalyser removed — createMediaElementSource graph is permanently bound

/**
 * Destroy the audio engine and clean up resources.
 * Closes the AudioContext and resets all state variables.
 * Safe to call multiple times.
 */
export function destroyEngine(): void {
  try {
    audioContext?.close().catch(() => {});
  } catch {
    // Ignore close errors
  }
  
  audioContext = null;
  analyserNode = null;
  mediaElement = null;
  elementConnected = false;
}
