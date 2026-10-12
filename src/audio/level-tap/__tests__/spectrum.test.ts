/**
 * The tap answers getByteFrequencyData / getByteTimeDomainData with an
 * AnalyserNode's arithmetic, so a visualizer written against the engine's
 * analyser reads the same picture on iOS.
 */
import { describe, expect, it } from "vitest";
import { FFT_SIZE, SpectrumState, fft, timeDomainBytes } from "../spectrum";

const RATE = 44_100;
const tone = (hz: number, amp: number) => Float32Array.from({ length: FFT_SIZE }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));

describe("spectrum", () => {
  it("the FFT finds a pure tone in its bin", () => {
    const re = Float32Array.from({ length: 64 }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / 64));
    const im = new Float32Array(64);
    fft(re, im);
    const mags = Array.from(re, (r, k) => Math.hypot(r, im[k]));
    expect(mags.indexOf(Math.max(...mags.slice(0, 32)))).toBe(5);
    expect(mags[5]).toBeCloseTo(32, 3);
  });

  it("frequency bytes peak at the tone's bin and rise with its level", () => {
    const loud = new SpectrumState();
    const quiet = new SpectrumState();
    const a = new Uint8Array(FFT_SIZE / 2);
    const b = new Uint8Array(FFT_SIZE / 2);
    // Smoothing remembers: let both settle.
    for (let i = 0; i < 30; i++) {
      loud.frequencyBytes(tone(1000, 0.8), a);
      quiet.frequencyBytes(tone(1000, 0.02), b);
    }
    const bin = Math.round((1000 * FFT_SIZE) / RATE);
    expect(Math.abs(a.indexOf(Math.max(...a)) - bin)).toBeLessThanOrEqual(1);
    expect(a[bin]).toBeGreaterThan(b[bin] + 50);
    expect(a[bin]).toBeLessThanOrEqual(255);
  });

  it("silence is zero in frequency and 128 in time", () => {
    const s = new SpectrumState();
    const f = new Uint8Array(FFT_SIZE / 2);
    s.frequencyBytes(new Float32Array(FFT_SIZE), f);
    expect(Math.max(...f)).toBe(0);
    const t = new Uint8Array(4);
    timeDomainBytes(new Float32Array(4), t);
    expect([...t]).toEqual([128, 128, 128, 128]);
    timeDomainBytes(Float32Array.from([-1, 1, 2, 0.5]), t);
    expect([...t]).toEqual([0, 255, 255, 192]);
  });
});
