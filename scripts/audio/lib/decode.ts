/**
 * ffmpeg/ffprobe for the audio scripts. A segment is decoded straight off its
 * URL with an input seek, which ffmpeg turns into an HTTP Range request: only
 * the minute asked for crosses the network, never the whole show.
 */
import { spawn } from "node:child_process";
import type { Clip } from "../../../src/audio/dsp/metrics.ts";

const UA = "HighDesert-audio-survey/1.0 (+https://highdesert.space)";

export interface Probe {
  codec: string;
  sampleRate: number;
  channels: number;
  bitRate: number;
  duration: number;
}

function run(cmd: string, args: string[], { maxBytes = 512 * 1024 * 1024 } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let size = 0;
    let err = "";
    p.stdout.on("data", (b: Buffer) => {
      size += b.length;
      if (size > maxBytes) p.kill("SIGKILL");
      else out.push(b);
    });
    p.stderr.on("data", (b: Buffer) => (err += b.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${cmd} exited ${code}: ${err.slice(0, 400)}`))));
  });
}

export async function probe(url: string): Promise<Probe> {
  const json = await run("ffprobe", ["-v", "error", "-user_agent", UA, "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels,bit_rate:format=duration,bit_rate", "-of", "json", url]);
  const j = JSON.parse(json.toString());
  const s = j.streams?.[0] ?? {};
  return {
    codec: s.codec_name ?? "",
    sampleRate: +s.sample_rate || 0,
    channels: +s.channels || 0,
    bitRate: +s.bit_rate || +j.format?.bit_rate || 0,
    duration: +j.format?.duration || 0,
  };
}

/** Decode `dur` seconds from `start` at `fs`, keeping the file's own channel count (1 or 2). */
export async function decode(url: string, start: number, dur: number, channels: number, fs = 48000): Promise<Clip> {
  const ch = Math.min(2, Math.max(1, channels));
  const args = ["-nostdin", "-hide_banner", "-loglevel", "error"];
  if (/^https?:/.test(url)) args.push("-user_agent", UA);
  if (start > 0) args.push("-ss", String(start));
  args.push("-t", String(dur), "-i", url, "-vn", "-ac", String(ch), "-ar", String(fs), "-f", "f32le", "-");
  const buf = await run("ffmpeg", args);
  const all = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4));
  const n = Math.floor(all.length / ch);
  const out = Array.from({ length: ch }, () => new Float32Array(n));
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) out[c][i] = all[i * ch + c];
  return { fs, ch: out };
}

/** Write a clip to a file (wav or mp3, by extension) through ffmpeg. */
export function encode(c: Clip, path: string, extra: string[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const n = c.ch[0].length;
    const k = c.ch.length;
    const inter = new Float32Array(n * k);
    for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) inter[i * k + j] = c.ch[j][i];
    const p = spawn("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-f", "f32le", "-ar", String(c.fs), "-ac", String(k), "-i", "-", ...extra, path], { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (b: Buffer) => (err += b.toString()));
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg encode exited ${code}: ${err.slice(0, 300)}`))));
    p.stdin.end(Buffer.from(inter.buffer));
  });
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
