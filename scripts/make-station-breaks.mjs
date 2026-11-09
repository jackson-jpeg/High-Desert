#!/usr/bin/env node
/**
 * Station Breaks: render the spoken spots (docs/station-breaks.md).
 *
 *   node scripts/make-station-breaks.mjs            # every spot
 *   node scripts/make-station-breaks.mjs sogojet    # one
 *   node scripts/make-station-breaks.mjs --voice en_US-norman-medium --out /tmp/x   # audition
 *   node scripts/make-station-breaks.mjs sogojet --chain light --out /tmp/y         # filter barely there
 *   node scripts/make-station-breaks.mjs sogojet --length-scale 1.1 --out /tmp/z    # another pace
 *
 * Reads data/station-breaks/spots.json. For each spot: the voice (Piper, self
 * hosted, no API; or a human take at data/station-breaks/recorded/<id>.wav),
 * then ffmpeg: a short synthesized sting, the voice, a warm vintage broadcast
 * texture (120 Hz to 5.5 kHz, a gentle 2 to 4 kHz presence lift so consonants
 * cut through, light compression, faint hiss; never soft clipping, which blurs
 * words), loudness matched to the station ID, mono MP3.
 *
 * Pace is Piper's length scale only; nothing is time-stretched afterwards.
 * Each sentence is rendered on its own and joined with `voice.sentencePause`
 * seconds of silence, so "Roswell. Rachel, Nevada. Point Pleasant." lands as
 * three names (Piper's own sentence split misses short ones, 2026-11-09). Writes public/audio/breaks/<id>.mp3
 * and src/data/station-break-audio.json (durations, which the schedule's
 * timing is built from, and digests).
 *
 * Needs: ffmpeg/ffprobe, and Piper at $PIPER_BIN (default
 * ~/.local/share/hd-piper-venv/bin/piper) with voices in $PIPER_VOICES
 * (default ~/.local/share/hd-piper-voices, `<model>.onnx` + `.onnx.json`
 * from huggingface.co/rhasspy/piper-voices). Runs niced; it is a few seconds
 * of CPU per spot.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SPOTS = path.join(ROOT, "data/station-breaks/spots.json");
const RECORDED = path.join(ROOT, "data/station-breaks/recorded");
const OUT_AUDIO = path.join(ROOT, "public/audio/breaks");
const OUT_META = path.join(ROOT, "src/data/station-break-audio.json");
/** The station ID's integrated loudness (public/audio/station-id.mp3, measured 2026-11-09). */
export const LOUDNESS_LUFS = -22.8;
/** The MP3 encode and the hiss land a spot about 0.4 LU under its target; aim that much higher. */
const ENCODE_LOSS_LU = 0.4;
export const STING_SEC = 1.4;

const PIPER = process.env.PIPER_BIN ?? path.join(homedir(), ".local/share/hd-piper-venv/bin/piper");
const VOICES = process.env.PIPER_VOICES ?? path.join(homedir(), ".local/share/hd-piper-voices");

/** Three rising notes (E5, A5, C#6) with a soft second harmonic and a quick decay. Not any network's chime. */
export function stingExpr() {
  const notes = [
    [0, 659.25],
    [0.2, 880],
    [0.4, 1108.73],
  ];
  return notes
    .map(
      ([t0, f]) =>
        `between(t,${t0},${STING_SEC})*exp(-3.2*(t-${t0}))*(0.30*sin(2*PI*${f}*(t-${t0}))+0.08*sin(4*PI*${f}*(t-${t0})))`,
    )
    .join("+");
}

/**
 * The texture, after the voice and sting are joined. `warm` is what airs: a
 * vintage broadcast, not a phone line. `light` is the filter barely there,
 * for comparison. `hiss` is the pink noise's amplitude.
 */
export const CHAINS = {
  warm: {
    filter: [
      "highpass=f=120:poles=2",
      "lowpass=f=5500:poles=2",
      "equalizer=f=3000:t=q:w=0.9:g=3",
      "acompressor=threshold=0.18:ratio=2:attack=12:release=200:makeup=1.4",
    ].join(","),
    hiss: 0.003,
  },
  light: {
    filter: ["highpass=f=70:poles=2", "lowpass=f=9500:poles=2", "equalizer=f=3000:t=q:w=0.9:g=1.5"].join(","),
    hiss: 0.001,
  },
};
export const AM_CHAIN = CHAINS.warm.filter;

/** A script's sentences: split after . ? ! (a pause is wanted after every one, however short). */
export function sentences(script) {
  return script.match(/[^.?!]+[.?!]+["')]*/g)?.map((x) => x.trim()).filter(Boolean) ?? [script.trim()];
}

function run(cmd, args, input) {
  return execFileSync("nice", ["-n", "15", cmd, ...args], { input, stdio: ["pipe", "pipe", "pipe"] }).toString();
}

/** loudnorm's first-pass measurement (ffmpeg prints it on stderr, as the last JSON object). */
function loudnormReport(file, target) {
  const r = spawnSync("nice", ["-n", "15", "ffmpeg", "-hide_banner", "-nostats", "-i", file, "-af", `loudnorm=${target}:print_format=json`, "-f", "null", "-"], { encoding: "utf8" });
  const text = r.stderr ?? "";
  const start = text.lastIndexOf("{");
  if (r.status !== 0 || start < 0) throw new Error(`loudnorm measurement failed for ${file}`);
  return JSON.parse(text.slice(start));
}

function durationOf(file) {
  return Number(run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).trim());
}

function voiceFor(spot, voice, work) {
  const human = path.join(RECORDED, `${spot.id}.wav`);
  if (existsSync(human)) return { file: human, by: "recorded" };
  const model = path.join(VOICES, `${voice.model}.onnx`);
  if (!existsSync(model)) throw new Error(`no Piper voice at ${model} (see the header of this script)`);
  const out = path.join(work, `${spot.id}-voice.wav`);
  const parts = sentences(spot.script).map((line, i) => {
    const f = path.join(work, `${spot.id}-s${i}.wav`);
    const noise = [
      ...(voice.noiseScale != null ? ["--noise-scale", String(voice.noiseScale)] : []),
      ...(voice.noiseW != null ? ["--noise-w", String(voice.noiseW)] : []),
    ];
    run(PIPER, ["-m", model, "-f", f, "--length-scale", String(voice.lengthScale ?? 1), ...noise, "--sentence-silence", "0"], line);
    return f;
  });
  // Each sentence, trimmed of Piper's own lead and tail silence, then the pause.
  const pause = voice.sentencePause ?? 0.4;
  const inputs = parts.flatMap((f) => ["-i", f]);
  const trim = "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse";
  const chains = parts.map((_, i) => `[${i}:a]aresample=22050,pan=mono|c0=c0,${trim},apad=pad_dur=${i < parts.length - 1 ? pause : 0}[p${i}]`);
  const graph = [...chains, `${parts.map((_, i) => `[p${i}]`).join("")}concat=n=${parts.length}:v=0:a=1[v]`].join(";");
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", graph, "-map", "[v]", out]);
  return { file: out, by: `piper ${voice.model} x${voice.lengthScale ?? 1}` };
}

function render(spot, voice, outDir, work, chain = CHAINS.warm) {
  if (/—/.test(spot.script)) throw new Error(`${spot.id}: an em dash in the script`);
  const v = voiceFor(spot, voice, work);
  const out = path.join(outDir, `${spot.id}.mp3`);
  const noise = `anoisesrc=color=pink:amplitude=${chain.hiss}:sample_rate=22050`;
  const graph = [
    `aevalsrc='${stingExpr()}':s=22050:d=${STING_SEC}[sting]`,
    `[0:a]aresample=22050,pan=mono|c0=c0,apad=pad_dur=0.5[v]`,
    `[sting][v]concat=n=2:v=0:a=1,${chain.filter}[dry]`,
    `${noise}[hiss]`,
    `[dry][hiss]amix=inputs=2:duration=first:weights=1 1:normalize=0,afade=t=in:d=0.02[out]`,
  ].join(";");
  const mix = path.join(work, `${spot.id}-mix.wav`);
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", v.file, "-filter_complex", graph, "-map", "[out]", "-ac", "1", "-ar", "22050", mix]);
  // Two-pass loudness, so the spot lands on the station ID's level rather than near it.
  const target = `I=${LOUDNESS_LUFS + ENCODE_LOSS_LU}:TP=-2:LRA=11`;
  const measured = loudnormReport(mix, target);
  const second = `loudnorm=${target}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
  run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", mix, "-af", second, "-ac", "1", "-ar", "22050", "-c:a", "libmp3lame", "-b:a", "64k", out]);
  const bytes = readFileSync(out);
  return {
    id: spot.id,
    cart: spot.cart,
    durationSec: Math.round(durationOf(out) * 100) / 100,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    voice: v.by,
    url: `/audio/breaks/${spot.id}.mp3`,
  };
}

function main() {
  const args = process.argv.slice(2);
  const cfg = JSON.parse(readFileSync(SPOTS, "utf8"));
  const voiceIdx = args.indexOf("--voice");
  const outIdx = args.indexOf("--out");
  const chainIdx = args.indexOf("--chain");
  const chainName = chainIdx >= 0 ? args[chainIdx + 1] : "warm";
  const chain = CHAINS[chainName];
  if (!chain) throw new Error(`--chain is one of ${Object.keys(CHAINS).join(", ")}`);
  const paceIdx = args.indexOf("--length-scale");
  const noiseIdx = args.indexOf("--noise-scale");
  const voice = {
    ...cfg.voice,
    ...(voiceIdx >= 0 ? { model: args[voiceIdx + 1] } : {}),
    ...(paceIdx >= 0 ? { lengthScale: Number(args[paceIdx + 1]) } : {}),
    ...(noiseIdx >= 0 ? { noiseScale: Number(args[noiseIdx + 1]) } : {}),
  };
  const audition = outIdx >= 0;
  const outDir = audition ? args[outIdx + 1] : OUT_AUDIO;
  const only = args.filter((a, i) => !a.startsWith("--") && !["--voice", "--out", "--chain", "--length-scale", "--noise-scale"].includes(args[i - 1]));
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(path.join(tmpdir(), "hd-breaks-"));
  try {
    const meta = existsSync(OUT_META) && !audition ? JSON.parse(readFileSync(OUT_META, "utf8")) : {};
    for (const spot of cfg.spots) {
      if (only.length && !only.includes(spot.id)) continue;
      const m = render(spot, voice, outDir, work, chain);
      console.log(`${m.id}  cart ${m.cart}  ${m.durationSec}s  ${m.voice}  -> ${path.join(outDir, `${m.id}.mp3`)}`);
      if (m.durationSec > 22) console.warn(`  ${m.id}: over 22 s; shorten the script or raise the voice's pace`);
      meta[m.id] = m;
    }
    if (!audition) writeFileSync(OUT_META, JSON.stringify(meta, null, 2) + "\n");
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
