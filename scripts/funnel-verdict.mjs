#!/usr/bin/env node
// The before-and-after verdict on the phone's one-tap "Listen live", on
// autopilot (docs/funnel.md, "Before and after").
//
// Run daily by highdesert-funnel-verdict.timer. Each run:
//   1. reads /api/stats/funnel and sums the phone cohorts from AFTER_SINCE on;
//   2. once they pass THRESHOLD arrivals, freezes the verdict, once, in
//      $STATE/verdict.json: it is never recomputed, so a later run cannot
//      quietly rewrite a result that has already been read;
//   3. writes it into docs/funnel.md between the funnel-verdict markers, in
//      its own checkout ($STATE/repo, never the production tree, whose HEAD
//      must stay the deployed commit), commits that one file and pushes it to
//      main; the production tree picks it up with its next pull;
//   4. copies docs/funnel.md to the Mac's ~/Downloads/high-desert-funnel/.
// Steps 3 and 4 are retried on every run until they have happened: the Mac is
// often asleep, and a push can lose a race. $STATE/status.json says where it
// is; highdesert-status's funnel line reads it.
//
// Environment (defaults are production):
//   HD_API (http://127.0.0.1:3003), HD_FUNNEL_STATE (/var/lib/highdesert-funnel),
//   HD_FUNNEL_REMOTE (origin of /root/High-Desert), HD_FUNNEL_MAC_DEST
//   (macbook:Downloads/high-desert-funnel/), HD_SCP (scp), HD_SSH (ssh),
//   HD_FUNNEL_THRESHOLD (300), HD_NOW (for tests)

import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The first cohort day entirely after #38 and #39. */
export const AFTER_SINCE = "2026-09-28";
/** "At least a few hundred phone arrivals" (docs/funnel.md). */
export const THRESHOLD = 300;
/** The recorded "before": phones, 2026-09-27 04:45 to 06:02:55 UTC. */
export const BEFORE = { visit: 20, live: 20, tune: 13, call: 0 };
export const START_MARK = "<!-- funnel-verdict:start -->";
export const END_MARK = "<!-- funnel-verdict:end -->";
const DOC = "docs/funnel.md";
/** Who the verdict commit is from. */
export const AUTHOR = { name: "High Desert funnel-verdict", email: "funnel-verdict@highdesert.space" };

/** The phone cohorts from `since` on, summed. */
export function afterCohort(funnel, since = AFTER_SINCE) {
  const sum = { visit: 0, live: 0, tune: 0, call: 0, days: 0 };
  for (const c of funnel?.cohorts ?? []) {
    if (c.device !== "phone" || c.day < since) continue;
    sum.days += 1;
    for (const k of ["visit", "live", "tune", "call"]) sum[k] += Number(c[k]) || 0;
  }
  return sum;
}

const pct = (n, d) => (d > 0 ? Math.round((100 * n) / d) : 0);

/**
 * Tune-in share after minus before, with a 95% interval (normal approximation
 * on the difference of two proportions). The word follows the interval, not
 * the point estimate: with 20 phones before, a 5-point gain is noise.
 */
export function compare(before, after) {
  const pb = before.visit ? before.tune / before.visit : 0;
  const pa = after.visit ? after.tune / after.visit : 0;
  const se = Math.sqrt((pb * (1 - pb)) / Math.max(1, before.visit) + (pa * (1 - pa)) / Math.max(1, after.visit));
  const diff = pa - pb;
  const lo = diff - 1.96 * se;
  const hi = diff + 1.96 * se;
  const word = lo > 0 ? "better" : hi < 0 ? "worse" : "no difference the data can see";
  return { diff: Math.round(diff * 100), lo: Math.round(lo * 100), hi: Math.round(hi * 100), word };
}

/** The verdict section, as it goes into docs/funnel.md. No em dashes. */
export function renderVerdict(v) {
  const { before, after, cmp } = v;
  const row = (name, s) =>
    `| ${name} | ${s.visit} | ${s.live} (${pct(s.live, s.visit)}%) | ${s.tune} (${pct(s.tune, s.visit)}%) | ${s.call} (${pct(s.call, s.visit)}%) |`;
  return [
    START_MARK,
    `**Verdict, written automatically at ${v.writtenAt}** by \`scripts/funnel-verdict.mjs\`, when the`,
    `phone cohorts from ${v.since} on passed ${v.threshold} arrivals (${after.days} cohort day${after.days === 1 ? "" : "s"}).`,
    "",
    "| Phones | First visits | Saw Live | Tuned in | Called |",
    "|---|---|---|---|---|",
    row("Before", before),
    row("After", after),
    "",
    `Tuned in: ${pct(before.tune, before.visit)}% before, ${pct(after.tune, after.visit)}% after, a change of`,
    `${cmp.diff >= 0 ? "+" : ""}${cmp.diff} points (95% interval ${cmp.lo} to ${cmp.hi}). **${cmp.word[0].toUpperCase()}${cmp.word.slice(1)}.**`,
    "",
    `The "before" is ${before.visit} phones over 78 minutes, so the interval is wide; the later`,
    "cohort days in \"after\" are still filling in, which can only raise their shares.",
    "This section is frozen: the job writes it once and never recomputes it.",
    END_MARK,
  ].join("\n");
}

/** docs/funnel.md with the section between the markers replaced. Throws without them. */
export function spliceDoc(doc, section) {
  const a = doc.indexOf(START_MARK);
  const b = doc.indexOf(END_MARK);
  if (a < 0 || b < a) throw new Error(`${DOC} has no ${START_MARK} … ${END_MARK} section`);
  return doc.slice(0, a) + section + doc.slice(b + END_MARK.length);
}

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 120_000, ...opts }, (err, out, errOut) =>
      err ? reject(new Error(`${cmd} ${args.join(" ")}: ${(errOut || err.message).trim()}`)) : resolve(out.trim()),
    ),
  );
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n");
  await rename(tmp, file);
}

/** Commit the verdict into docs/funnel.md on main, from the job's own checkout. */
async function publish(state, section, remote) {
  const repo = path.join(state, "repo");
  // Its own identity, not whatever the box's global git config says: a
  // machine without one (CI, a fresh box) refused the commit, and the verdict
  // would never have landed.
  const git = (...a) => sh("git", ["-C", repo, "-c", `user.name=${AUTHOR.name}`, "-c", `user.email=${AUTHOR.email}`, ...a]);
  if (!existsSync(path.join(repo, ".git"))) await sh("git", ["clone", "-q", remote, repo]);
  await git("fetch", "-q", "origin", "main");
  await git("checkout", "-q", "--detach", "origin/main");
  const file = path.join(repo, DOC);
  const doc = await readFile(file, "utf8");
  const next = spliceDoc(doc, section);
  if (next !== doc) {
    await writeFile(file, next);
    await git("add", DOC);
    await git("commit", "-q", "-m", "docs(funnel): the before and after verdict, written by funnel-verdict");
  }
  // --no-verify: a machine-made push of one doc from a checkout with no
  // node_modules; no hook the box might carry can run in it.
  await git("push", "-q", "--no-verify", "origin", "HEAD:main");
  return { sha: await git("rev-parse", "--short", "HEAD"), file };
}

export async function main(env = process.env) {
  const api = env.HD_API ?? "http://127.0.0.1:3003";
  const state = env.HD_FUNNEL_STATE ?? "/var/lib/highdesert-funnel";
  const threshold = Number(env.HD_FUNNEL_THRESHOLD ?? THRESHOLD);
  const macDest = env.HD_FUNNEL_MAC_DEST ?? "macbook:Downloads/high-desert-funnel/";
  const now = env.HD_NOW ?? new Date().toISOString();
  await mkdir(state, { recursive: true });

  const statusFile = path.join(state, "status.json");
  const status = (await readJson(statusFile)) ?? {};
  status.checkedAt = now;
  status.threshold = threshold;
  status.since = AFTER_SINCE;
  status.error = null;

  try {
    const res = await fetch(`${api}/api/stats/funnel?days=90`);
    if (!res.ok) throw new Error(`/api/stats/funnel answered ${res.status}`);
    status.after = afterCohort(await res.json());

    if (!status.verdict && status.after.visit >= threshold) {
      const after = status.after;
      status.verdict = { writtenAt: now, since: AFTER_SINCE, threshold, before: BEFORE, after, cmp: compare(BEFORE, after) };
    }
    if (status.verdict && !status.pushedSha) {
      const remote = env.HD_FUNNEL_REMOTE ?? (await sh("git", ["-C", "/root/High-Desert", "remote", "get-url", "origin"]));
      const { sha } = await publish(state, renderVerdict(status.verdict), remote);
      status.pushedSha = sha;
    }
    if (status.pushedSha && !status.copiedAt) {
      const doc = path.join(state, "repo", DOC);
      const [host, dir] = macDest.split(":");
      await sh(env.HD_SSH ?? "ssh", ["-o", "ConnectTimeout=10", host, `mkdir -p ${JSON.stringify(dir)}`]);
      await sh(env.HD_SCP ?? "scp", ["-o", "ConnectTimeout=10", doc, macDest]);
      status.copiedAt = now;
    }
  } catch (err) {
    status.error = String(err.message ?? err).slice(0, 300);
  }
  await writeJson(statusFile, status);
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await main();
  console.log(JSON.stringify(s));
  // A Mac that is asleep is normal; anything else wants attention.
  process.exit(s.error && !(s.pushedSha && /ssh|scp/.test(s.error)) ? 1 : 0);
}
