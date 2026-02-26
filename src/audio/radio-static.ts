/**
 * Radio Static Audio Engine
 *
 * Completely independent AudioContext from the main playback engine.
 * Generates AM-radio-style white noise through a bandpass filter,
 * with volume controlled by signal proximity.
 */

let ctx: AudioContext | null = null;
let noiseSource: AudioBufferSourceNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let gainNode: GainNode | null = null;
let filterNode: BiquadFilterNode | null = null;
let initialized = false;

/**
 * Initialize the radio static AudioContext.
 * Must be called from a user gesture (click/touch).
 */
export function initRadioStatic(): void {
  if (initialized) return;

  try {
    ctx = new AudioContext();

    // Generate 2-second noise buffer
    if (!ctx) {
      console.warn("[radio-static] AudioContext creation failed");
      return;
    }
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * 2;
    noiseBuffer = ctx.createBuffer(1, length, sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    // Bandpass filter for AM radio character
    filterNode = ctx.createBiquadFilter();
    filterNode.type = "bandpass";
    filterNode.frequency.value = 1000;
    filterNode.Q.value = 0.5;

    // Gain control
    gainNode = ctx.createGain();
    gainNode.gain.value = 0;

    // Chain: noise → filter → gain → output
    filterNode.connect(gainNode);
    gainNode.connect(ctx.destination);

    // Start the looping noise source
    startNoise();

    initialized = true;
  } catch (error) {
    console.warn("[radio-static] Failed to initialize audio:", error);
    ctx = null;
    initialized = true; // Prevent repeated initialization attempts
  }
}

function startNoise(): void {
  if (!ctx || !noiseBuffer || !filterNode) return;

  // Stop previous source if any
  try {
    noiseSource?.stop();
    noiseSource?.disconnect();
  } catch {
    /* ignore */
  }

  noiseSource = ctx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;
  noiseSource.connect(filterNode);
  noiseSource.start();
}

/**
 * Set the static volume based on signal strength.
 * signalStrength=0 → full static, signalStrength=1 → silent
 */
export function setStaticVolume(signalStrength: number): void {
  if (!gainNode || !ctx) {
    console.warn("[radio-static] Cannot set volume: audio not initialized");
    return;
  }

  // Resume context if suspended (browser autoplay policy)
  if (ctx.state === "suspended") {
    ctx.resume().catch((err) => { console.warn("[radio-static] Failed to resume context:", err); });
  }

  const volume = Math.max(0, 1 - signalStrength) * 0.15; // Max 15% volume
  gainNode.gain.setTargetAtTime(volume, ctx.currentTime, 0.05);
}

/**
 * Mute the static immediately.
 */
export function muteStatic(): void {
  if (!gainNode || !ctx) return;
  gainNode.gain.setTargetAtTime(0, ctx.currentTime, 0.01);
}

/**
 * Play a short lock tone (880Hz sine, 150ms decay).
 */
export function playLockTone(): void {
  if (!ctx) {
    console.warn("[radio-static] Cannot play lock tone: audio not initialized");
    return;
  }

  // Resume context if needed
  if (ctx.state === "suspended") {
    ctx.resume().catch((err) => { console.warn("[radio-static] Failed to resume context:", err); });
  }

  try {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = "sine";
    osc.frequency.value = 880;

    env.gain.value = 0.12;
    env.gain.setTargetAtTime(0, ctx.currentTime + 0.01, 0.04);

    osc.connect(env);
    env.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.15);
  } catch (error) {
    console.warn("[radio-static] Failed to play lock tone:", error);
  }
}

/**
 * Clean up the audio context.
 */
export function destroyRadioStatic(): void {
  try {
    noiseSource?.stop();
    noiseSource?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    filterNode?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    gainNode?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    ctx?.close();
  } catch {
    /* ignore */
  }

  noiseSource = null;
  filterNode = null;
  gainNode = null;
  ctx = null;
  noiseBuffer = null;
  initialized = false;
}

/**
 * Whether the radio static engine is initialized.
 */
export function isRadioStaticInitialized(): boolean {
  return initialized;
}
