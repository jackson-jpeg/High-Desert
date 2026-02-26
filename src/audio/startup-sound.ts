/**
 * Synthesize a brief "radio tuning" sweep sound using Web Audio API.
 * Only plays once per session, respects user preference in Dexie.
 */

import { getPreference } from "@/db";

let hasPlayed = false;

export async function playStartupSound(): Promise<void> {
  // Only once per session
  if (hasPlayed) return;
  if (sessionStorage.getItem("hd-startup-played")) return;

  // Check user preference
  try {
    const pref = await getPreference("startup-sound");
    if (pref === "off") return;
  } catch {
    // DB not ready, skip
    return;
  }

  hasPlayed = true;
  sessionStorage.setItem("hd-startup-played", "1");

  try {
    if (typeof window === 'undefined') {
      console.warn('[startup-sound] Window not available');
      return;
    }
    
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) {
      console.warn('[startup-sound] Web Audio API not supported');
      return;
    }
    
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioCtx();
    } catch (error) {
      console.warn('[startup-sound] Failed to create AudioContext:', error);
      return;
    }
    
    if (!ctx || ctx.state === 'closed') {
      console.warn('[startup-sound] AudioContext creation failed or returned invalid state');
      return;
    }

    // Sweep oscillator: 200Hz → 1200Hz → 400Hz over 0.5s
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.2);
    osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.45);

    // Add some noise texture via a second oscillator
    const noise = ctx.createOscillator();
    const noiseGain = ctx.createGain();
    noise.type = "sawtooth";
    noise.frequency.setValueAtTime(80, ctx.currentTime);
    noise.frequency.linearRampToValueAtTime(120, ctx.currentTime + 0.5);
    noiseGain.gain.setValueAtTime(0.03, ctx.currentTime);
    noiseGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
    noise.connect(noiseGain).connect(ctx.destination);

    // Envelope
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.12, ctx.currentTime + 0.35);
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);

    osc.connect(gain).connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
    noise.start(ctx.currentTime);
    noise.stop(ctx.currentTime + 0.5);

    // Clean up
    setTimeout(() => {
      try {
        if (ctx && ctx.state !== 'closed') {
          ctx.close().catch(() => {});
        }
      } catch {
        // Ignore close errors
      }
    }, 1000);
  } catch (error) {
    console.warn('[startup-sound] Web Audio not available:', error);
  }
}
