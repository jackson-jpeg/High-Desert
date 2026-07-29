#!/usr/bin/env node
/**
 * Audit every episode in public/seed/library.json for streamability.
 *
 * Written after a user reported that shows "sometimes don't start". The root
 * cause turned out to be client-side (the restore path never assigned
 * audio.src), but a per-file check was still worth having: the catalog is a
 * collection of community rips of wildly varying provenance, and a single dead
 * or mis-served URL is indistinguishable from the client bug from the user's
 * side of the screen.
 *
 * Sends a ranged request for the first KB of each file, so it reads headers
 * without pulling ~30GB of audio. A plain HEAD is not enough: it tells us
 * nothing about whether the origin actually honours Range, which is what iOS
 * requires before it will begin playback of a large file.
 *
 * Read-only. Changes no data and re-encodes nothing.
 *
 *   node scripts/audit-episodes.mjs [--rate 2] [--limit N] [--out report.json]
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED = join(__dirname, "..", "public", "seed", "library.json");

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const RATE = Number(arg("rate", 2)); // requests per second
const LIMIT = Number(arg("limit", 0)); // 0 = all
const OUT = arg("out", join(__dirname, "..", "episode-audit.json"));

const GAP_MS = Math.ceil(1000 / RATE);
const MAX_ATTEMPTS = 4;
const TIMEOUT_MS = 30_000;

/** Spoken word has no business above this. Flags re-encode candidates. */
const BITRATE_WARN_KBPS = 96;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One ranged request. Retries on network error and on 5xx/429, which
 * archive.org returns under load — a retry there is not papering over a broken
 * file, it is the documented way to talk to the service.
 */
async function probe(url) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Range: "bytes=0-1023" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
      });

      // Drain so the socket can be reused rather than left dangling.
      await res.arrayBuffer().catch(() => {});

      if ((res.status >= 500 || res.status === 429) && attempt < MAX_ATTEMPTS) {
        lastError = `HTTP ${res.status}`;
        await sleep(1000 * 2 ** (attempt - 1));
        continue;
      }

      const range = res.headers.get("content-range");
      // "bytes 0-1023/23473241" — the total is the only place we learn the real
      // file size, since Content-Length on a 206 is the slice, not the file.
      const total = range ? Number(range.split("/")[1]) : null;

      return {
        status: res.status,
        contentType: res.headers.get("content-type"),
        acceptRanges: res.headers.get("accept-ranges"),
        contentRange: range,
        size: Number.isFinite(total) ? total : null,
        finalUrl: res.url,
        attempts: attempt,
      };
    } catch (err) {
      lastError = err?.message ?? String(err);
      if (attempt < MAX_ATTEMPTS) await sleep(1000 * 2 ** (attempt - 1));
    }
  }

  return { status: null, error: lastError, attempts: MAX_ATTEMPTS };
}

function classify(ep, result) {
  const problems = [];

  if (result.status === null) {
    problems.push({ kind: "unreachable", detail: result.error });
    return problems;
  }
  if (result.status === 206) {
    // The happy path.
  } else if (result.status === 200) {
    // Fatal for iOS: it will not begin a large file the origin won't seek into.
    problems.push({ kind: "no-range-support", detail: "200 instead of 206" });
  } else {
    problems.push({ kind: "bad-status", detail: `HTTP ${result.status}` });
  }

  const ct = (result.contentType ?? "").toLowerCase();
  if (ct && !ct.startsWith("audio/")) {
    problems.push({ kind: "bad-content-type", detail: result.contentType });
  }
  if (result.acceptRanges && result.acceptRanges !== "bytes") {
    problems.push({ kind: "bad-accept-ranges", detail: result.acceptRanges });
  }
  if (result.size === 0) {
    problems.push({ kind: "empty-file", detail: "0 bytes" });
  }

  // Bitrate needs a duration to divide by; the seed catalog carries one for
  // most rows, and a missing duration is itself worth knowing about.
  if (result.size && ep.duration && ep.duration > 60) {
    const kbps = Math.round((result.size * 8) / ep.duration / 1000);
    if (kbps > BITRATE_WARN_KBPS) {
      problems.push({
        kind: "high-bitrate",
        detail: `~${kbps}kbps over ${Math.round(ep.duration / 60)}min`,
      });
    }
  } else if (result.size && !ep.duration) {
    problems.push({ kind: "no-duration-in-catalog", detail: null });
  }

  return problems;
}

async function main() {
  const raw = JSON.parse(await readFile(SEED, "utf8"));
  const all = Array.isArray(raw) ? raw : raw.episodes;
  const episodes = LIMIT > 0 ? all.slice(0, LIMIT) : all;

  console.log(
    `Auditing ${episodes.length} episodes at ~${RATE}/sec ` +
      `(≈${Math.ceil((episodes.length * GAP_MS) / 60000)} min)\n`,
  );

  const flagged = [];
  const sizes = [];
  let ok = 0;
  const startedAt = Date.now();

  for (const [i, ep] of episodes.entries()) {
    if (!ep.sourceUrl) {
      flagged.push({
        title: ep.title,
        fileHash: ep.fileHash,
        url: null,
        problems: [{ kind: "no-source-url", detail: null }],
      });
      continue;
    }

    const result = await probe(ep.sourceUrl);
    const problems = classify(ep, result);
    if (result.size) sizes.push(result.size);

    if (problems.length) {
      flagged.push({
        title: ep.title,
        fileHash: ep.fileHash,
        url: ep.sourceUrl,
        status: result.status,
        size: result.size,
        problems,
      });
      const kinds = problems.map((p) => p.kind).join(", ");
      console.log(`  ✗ [${i + 1}/${episodes.length}] ${kinds} — ${ep.title}`);
    } else {
      ok++;
    }

    if ((i + 1) % 100 === 0) {
      const mins = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(
        `  … ${i + 1}/${episodes.length} — ${ok} ok, ${flagged.length} flagged (${mins} min)`,
      );
    }

    await sleep(GAP_MS);
  }

  sizes.sort((a, b) => a - b);
  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  const summary = {
    checked: episodes.length,
    ok,
    flagged: flagged.length,
    sizeMB: sizes.length
      ? {
          min: mb(sizes[0]),
          median: mb(sizes[Math.floor(sizes.length / 2)]),
          max: mb(sizes[sizes.length - 1]),
          totalGB: (sizes.reduce((a, b) => a + b, 0) / 1024 ** 3).toFixed(1),
        }
      : null,
    byKind: {},
  };
  for (const f of flagged) {
    for (const p of f.problems) {
      summary.byKind[p.kind] = (summary.byKind[p.kind] ?? 0) + 1;
    }
  }

  await writeFile(OUT, JSON.stringify({ summary, flagged }, null, 2));

  console.log(`\n${"─".repeat(60)}`);
  console.log(`checked ${summary.checked} · ok ${summary.ok} · flagged ${summary.flagged}`);
  if (summary.sizeMB) {
    console.log(
      `size  min ${summary.sizeMB.min}MB · median ${summary.sizeMB.median}MB · ` +
        `max ${summary.sizeMB.max}MB · total ${summary.sizeMB.totalGB}GB`,
    );
  }
  for (const [kind, n] of Object.entries(summary.byKind)) {
    console.log(`  ${kind}: ${n}`);
  }
  console.log(`\nreport → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
