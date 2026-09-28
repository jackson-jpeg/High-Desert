#!/usr/bin/env node
// The weekly digest: one screen on how High Desert did, written for Jackson
// to read without opening a terminal (docs/digest/README.md).
//
// Run daily at 17:40 UTC by highdesert-digest.timer. A run writes the digest
// for the latest Monday that is due (Monday 17:40 UTC or later), once:
//   1. gathers the week: highdesert-status, /api/stats/traffic?range=7d, the
//      funnel verdict job's status, and the week's rows from Postgres (plays,
//      failures, callers' places);
//   2. renders docs/digest/YYYY-MM-DD.md: what needs action first, then the
//      release line, the funnel, locked phones, the week, and health. When a
//      check FAILs or the release is over 3% on 300+ plays, it adds the
//      evidence for a fix session: the rows, the pattern, a proposed fix;
//   3. commits that one file to main from its own checkout ($STATE/repo, never
//      the production tree, whose HEAD must stay the deployed commit) and
//      pushes it;
//   4. copies it to the Mac's ~/Downloads/high-desert-digest/.
// A written week is frozen: it is never regenerated. Steps 3 and 4 are retried
// on every run until they have happened (the Mac is often asleep). A Tuesday
// run writes Monday's if Monday's run never happened. $STATE/status.json says
// where it is; highdesert-status's digest line reads it.
//
// Environment (defaults are production):
//   HD_ROOT (/root/High-Desert), HD_API (http://127.0.0.1:3003),
//   HD_DIGEST_STATE (/var/lib/highdesert-digest), HD_DIGEST_REMOTE (origin of
//   HD_ROOT), HD_DIGEST_MAC_DEST (macbook:Downloads/high-desert-digest/),
//   HD_STATUS_CMD (highdesert-status), HD_FUNNEL_STATUS
//   (/var/lib/highdesert-funnel/status.json), DATABASE_URL, HD_SCP, HD_SSH,
//   HD_NOW (for tests)

import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DIGEST_DIR = "docs/digest";
/** The release line's target, and the plays it needs before it is a verdict (scripts/status.sh). */
export const TARGET_PCT = 3;
export const VERDICT_PLAYS = 300;
/** The first week with a digest: the job went in on 2026-09-28, and a digest for the week before it would be mislabelled. */
export const FIRST_DUE = "2026-10-05";
/** When the week's digest is due: Monday, 17:40 UTC. */
export const DUE_UTC = { weekday: 1, hour: 17, minute: 40 };
/** Who the digest commit is from. */
export const AUTHOR = { name: "High Desert digest", email: "digest@highdesert.space" };
/** Failure kinds that never stopped playback (src/services/stats/db/failures.ts). */
export const ADVISORY_KINDS = ["empty-media-suspected"];
/** The main part must fit one screen; evidence, when there is any, follows it. */
export const SCREEN_LINES = 40;

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

/** The Monday whose digest is due at `now`: this week's from 17:40 UTC Monday, else last week's. */
export function dueDay(now) {
  const t = new Date(now);
  const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
  const back = (d.getUTCDay() - DUE_UTC.weekday + 7) % 7;
  d.setUTCDate(d.getUTCDate() - back);
  const due = d.getTime() + (DUE_UTC.hour * 60 + DUE_UTC.minute) * 60_000;
  if (t.getTime() < due) d.setUTCDate(d.getUTCDate() - 7);
  return d.toISOString().slice(0, 10);
}

/** highdesert-status's lines: `LEVEL  area      text`. */
export function parseStatus(text) {
  const out = [];
  for (const raw of String(text ?? "").split("\n")) {
    const m = /^(OK|WARN|FAIL)\s+(\S+)\s+(.*)$/.exec(raw.trimEnd());
    if (m) out.push({ level: m[1], area: m[2], text: m[3] });
  }
  return out;
}

/** The numbers in status's release line (scripts/status.sh writes it). Null if it has none. */
export function parseRelease(line) {
  if (!line) return null;
  const t = line.text;
  const older = /older builds: (\d+) failures \/ (\d+) plays/.exec(t);
  const o = older ? { failures: Number(older[1]), plays: Number(older[2]) } : null;
  // Whose rows: a status.sh from before the build split counts every build.
  const whose = /this release's builds/.test(t) ? "on this release's builds" : "across all builds";
  if (/^no plays yet/.test(t)) return { pct: 0, failures: 0, plays: 0, older: o, whose, level: line.level, text: t };
  const m = /^([\d.]+)% of starts failed.*?\((\d+) failures \/ (\d+) plays/.exec(t);
  if (!m) return { pct: null, failures: null, plays: null, older: o, whose, level: line.level, text: t };
  return { pct: Number(m[1]), failures: Number(m[2]), plays: Number(m[3]), older: o, whose, level: line.level, text: t };
}

/** "pass" / "fail" once there are VERDICT_PLAYS plays, else null (not yet). */
export function releaseVerdict(r) {
  if (!r || r.plays === null || r.plays < VERDICT_PLAYS) return null;
  return r.pct >= TARGET_PCT ? "fail" : "pass";
}

/** The release's builds: the commit on the baseline doc's release line, and every deploy since. */
export function releaseBuilds(baselineDoc, history) {
  const at = /^\*\*Release deployed:\*\* `([^`]*)`/m.exec(baselineDoc ?? "")?.[1] ?? null;
  const ref = /^\*\*Release deployed:\*\* `[^`]*` \(([0-9a-f]{7,40})\)/m.exec(baselineDoc ?? "")?.[1] ?? null;
  const builds = ref ? [ref] : [];
  for (const l of String(history ?? "").split("\n")) {
    const [b, when] = l.trim().split(/\s+/);
    if (b && when && at && when >= at) builds.push(b);
  }
  return { at, builds };
}

/** A row's build is the release's: a prefix either way (short and full SHAs). */
export function isReleaseBuild(build, builds) {
  return !!build && builds.some((r) => build.startsWith(r) || r.startsWith(build));
}

const count = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = key(r) ?? "unknown";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
};
const list = (pairs, n = 4) => pairs.slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ");
const share = (part, whole) => (whole ? Math.round((100 * part) / whole) : 0);

/** Where a failure row was when it happened, from its detail (the live station writes it). */
export function visibilityOf(detail) {
  const m = /\b(hidden|visible)\b/.exec(detail ?? "");
  return m ? m[1] : null;
}

/** What the week's handover-rejected rows say about locked phones. */
export function lockedPhones(rows) {
  if (!rows.length) {
    return { lines: ["None this week: no phone refused a change of show."], hiddenShare: 0, n: 0 };
  }
  const hidden = rows.filter((r) => visibilityOf(r.detail) === "hidden").length;
  const reload = rows.filter((r) => /^reload\b/.test(r.detail ?? "")).length;
  const recovered = rows.filter((r) => r.recovered).length;
  const byUa = count(rows, (r) => r.uaClass);
  const hs = share(hidden, rows.length);
  const lines = [
    `${rows.length} refusal${rows.length === 1 ? "" : "s"}: ${hidden} with the page hidden (a locked or backgrounded phone), ${rows.length - hidden} on screen` +
      (reload ? `, ${reload} right after the tab updated itself` : "") +
      `. By device: ${list(byUa)}. ${recovered} came back without a tap.`,
  ];
  if (hs >= 60) {
    lines.push(
      "What it says: locked phones are refusing to start the next show on their own. Until that changes, the rejoin tap on the lock screen is the only way back.",
    );
  } else {
    lines.push(
      "What it says: most refusals happened with the page on screen, so this is not the lock screen. The rows' details say which transition failed.",
    );
  }
  if (reload) lines.push(`${reload} came after a self-reload: that browser does not keep sound across a reload, and the tab should have waited for a pause.`);
  return { lines, hiddenShare: hs, n: rows.length };
}

/** Counts that describe a set of failure rows. */
export function patternOf(rows, titleOf = (id) => id) {
  const n = rows.length;
  const kinds = count(rows, (r) => r.kind);
  const uas = count(rows, (r) => r.uaClass);
  const sources = count(rows, (r) => r.source);
  const eps = count(rows, (r) => r.episodeId);
  const vis = count(rows.filter((r) => visibilityOf(r.detail)), (r) => visibilityOf(r.detail));
  const recovered = rows.filter((r) => r.recovered).length;
  const hours = count(rows, (r) => new Date(r.at).toISOString().slice(0, 13).replace("T", " ") + ":00");
  return {
    n,
    kinds,
    uas,
    sources,
    eps,
    vis,
    recovered,
    hours,
    lines: [
      `By kind: ${list(kinds)}.`,
      `By device: ${list(uas)}.`,
      `By source: ${list(sources)}. ${recovered} of ${n} recovered.`,
      ...(vis.length ? [`Page: ${list(vis)}.`] : []),
      `Most failing show: ${eps.length ? `${titleOf(eps[0][0])} (${eps[0][1]} of ${n})` : "none"}.`,
      `Busiest hour: ${hours.length ? `${hours[0][0]} UTC (${hours[0][1]})` : "none"}.`,
    ],
  };
}

/** A first guess at the fix, from the pattern. A proposal for a fix session, not a diagnosis. */
export function proposeFix(p, titleOf = (id) => id) {
  const out = [];
  if (!p.n) return ["No rows to go on: read the status line itself."];
  const [topKind, topKindN] = p.kinds[0];
  const [topEp, topEpN] = p.eps[0] ?? [null, 0];
  const [topUa, topUaN] = p.uas[0];
  if (topEp && topEpN / p.n >= 0.5) {
    out.push(
      `One show is most of it: ${titleOf(topEp)}. Run scripts/audit-durations.mjs on it; if the file is broken, pull it from the catalog (CLAUDE.md, "Pulling an episode").`,
    );
  }
  if (["stall", "timeout", "network-error"].includes(topKind) && topKindN / p.n >= 0.5) {
    const archive = (p.sources.find(([s]) => s === "archive")?.[1] ?? 0) / p.n;
    out.push(
      archive >= 0.5
        ? `Mostly ${topKind} on archive.org and ${p.recovered} of ${p.n} recovered: check that failover reaches the mirror (src/audio/playback-watchdog.ts) and that the failing shows are pinned (the warm job's top list).`
        : `Mostly ${topKind} off the mirror: check nginx's fill of unpinned shows and the mirror line in highdesert-status.`,
    );
  }
  if (topKind === "play-rejected" && topKindN / p.n >= 0.5) {
    out.push(
      "Mostly play-rejected: the browser refused sound. The details name the path (play <name>); find the start that happens outside a tap and move it inside one.",
    );
  }
  if (topKind === "handover-rejected" && topKindN / p.n >= 0.5) {
    out.push(
      "Mostly handover-rejected: phones refusing the next show. Check the hidden share above; if it is locked phones, the bridge (engine.ts) is the place to look.",
    );
  }
  if (["decode-error", "empty-media"].includes(topKind) && topKindN / p.n >= 0.5) {
    out.push("Mostly bad bytes (decode or empty): find the shows in the rows and audit their files.");
  }
  if (topUaN / p.n >= 0.7 && p.uas.length > 1) {
    out.push(`${share(topUaN, p.n)}% on ${topUa}: reproduce on that browser before changing anything shared.`);
  }
  if (!out.length) out.push(`No single cause stands out (top kind ${topKind}, ${topKindN} of ${p.n}). Start from the rows, oldest first.`);
  return out;
}

/** What to do about a FAIL, by the area of its status line. */
export const FAIL_ACTIONS = {
  deploy: "Deploy what is on main: git pull --ff-only in /root/High-Desert, then nice -n -15 ionice -c2 -n0 bash scripts/deploy.sh.",
  service: "The site's service is down: systemctl status highdesert and journalctl -u highdesert -n 200.",
  backup: "The DB backup: highdesert-backup-status, then the timer's journal (docs/backup.md).",
  sampler: "The traffic sampler: systemctl status highdesert-sample.timer and its last run's journal.",
  failures: "Failures over the week are high: the rows below, and /api/stats/failures?days=7.",
  peaks: "Peaks are not nested: the traffic_daily rollup (docs/stats-audit.md, finding 12).",
  presence: "Presence surfaces disagree: scripts/presence-check.mjs, and src/services/stats/now-feed.ts.",
  mirror: "The mirror: bash scripts/deploy-mirror.sh --verify-only, then the warm job's status.",
  cpu: "A High Desert unit is over 10% of a core: the unit named in the line needs CPUQuota and Nice (CLAUDE.md, CPU rule).",
  live: "The phone lines: systemctl status highdesert-live, and docs/live-chat.md.",
  warm: "The warm job: /var/cache/highdesert-mirror/warm-status.json and its journal.",
  steal: "Hypervisor steal is high: nothing to fix here; note it and watch the CPU line.",
  audit: "npm audit found a high or critical: a dependency upgrade in a worktree (CLAUDE.md, Dependabot).",
  funnel: "The funnel line: /api/stats/funnel?days=7 and docs/funnel.md.",
  release: "The release line: the rows below.",
  nginx: "The installed vhost differs from deploy/nginx/highdesert.conf: diff them and install the one in git.",
  digest: "The digest job itself: /var/lib/highdesert-digest/status.json and journalctl -u highdesert-digest.",
};

/** Why this digest carries evidence: any FAIL, or the release over target on a real sample. */
export function evidenceReasons(status, release) {
  const reasons = status.filter((l) => l.level === "FAIL").map((l) => ({ area: l.area, text: `FAIL ${l.area}: ${l.text}` }));
  if (release && release.plays >= VERDICT_PLAYS && release.pct >= TARGET_PCT) {
    reasons.push({ area: "release", text: `The release is at ${release.pct}% on ${release.plays} plays, over the ${TARGET_PCT}% target.` });
  }
  return reasons;
}

const fmtN = (n) => Number(n ?? 0).toLocaleString("en-US");
const DAY_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const SHORT_FMT = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });
/** Table cells: no pipes, no newlines, short. */
const cell = (v, n = 60) => String(v ?? "").replace(/[|\n\r]/g, " ").slice(0, n);

/** The digest as markdown. No em dashes anywhere (CLAUDE.md, user-facing copy). */
export function render(d) {
  const { day, writtenAt, status, release, funnel, handover, traffic, topShows, places, disk, evidence, titleOf, missing = [] } = d;
  const L = [];
  L.push(`# High Desert, week to ${DAY_FMT.format(new Date(`${day}T00:00:00Z`))}`);
  L.push("");
  L.push(`The seven days to ${writtenAt.slice(0, 16).replace("T", " ")} UTC. Written by scripts/digest.mjs.`);
  L.push("");

  // What needs action goes first.
  const actions = [];
  for (const l of status.filter((x) => x.level === "FAIL")) actions.push(`**FAIL ${l.area}:** ${cell(l.text, 160)} ${FAIL_ACTIONS[l.area] ?? ""}`.trim());
  const verdict = releaseVerdict(release);
  if (verdict === "fail") actions.push(`**Release over target:** ${release.pct}% of starts failed on ${fmtN(release.plays)} plays (target under ${TARGET_PCT}%).`);
  if (missing.length) actions.push(`**Could not read:** ${missing.join(", ")}. The digest job's journal says why.`);
  if (evidence) actions.push("The evidence for a fix session is at the bottom.");
  L.push("## Needs you");
  L.push("");
  if (actions.length) for (const a of actions) L.push(`- ${a}`);
  else L.push("Nothing this week.");
  L.push("");

  L.push("## Release");
  L.push("");
  if (!release || release.plays === null) {
    L.push(`No reading: ${release ? cell(release.text, 200) : "highdesert-status gave no release line"}.`);
  } else if (release.plays === 0) {
    L.push(`No plays ${release.whose} since the release yet.`);
  } else {
    const word = verdict === "pass" ? "Under target: pass." : verdict === "fail" ? "Over target: fail." : `No verdict yet: ${fmtN(release.plays)} of ${VERDICT_PLAYS} plays.`;
    L.push(`${release.pct}% of starts failed ${release.whose} (${release.failures} of ${fmtN(release.plays)} plays; target under ${TARGET_PCT}%). ${word}`);
  }
  if (release?.older) L.push(`Tabs on older builds: ${release.older.failures} failures in ${fmtN(release.older.plays)} plays, counted apart.`);
  L.push("");

  L.push("## Funnel");
  L.push("");
  if (funnel?.verdict) {
    const c = funnel.verdict.cmp;
    L.push(`Verdict (written ${String(funnel.verdict.writtenAt).slice(0, 10)}): ${c.word}. Tune-in share on phones ${c.diff >= 0 ? "+" : ""}${c.diff} points (95% interval ${c.lo} to ${c.hi}).`);
  } else if (funnel?.after) {
    const a = funnel.after;
    L.push(`${fmtN(a.visit)} of ${funnel.threshold ?? 300} phone arrivals so far; ${share(a.tune, a.visit)}% tuned in, ${share(a.call, a.visit)}% called. No verdict until ${funnel.threshold ?? 300}.`);
  } else {
    L.push("No reading from the funnel job.");
  }
  L.push("");

  L.push("## Locked phones");
  L.push("");
  for (const l of handover.lines) L.push(l);
  L.push("");

  L.push("## The week");
  L.push("");
  if (traffic) {
    L.push(
      `- Peak ${traffic.peakOnline} online and ${traffic.peakListening} listening` +
        (traffic.peakAt ? ` (${SHORT_FMT.format(new Date(traffic.peakAt))} UTC)` : "") +
        `. ${fmtN(traffic.playsInRange)} plays.`,
    );
  } else {
    L.push("- No traffic reading.");
  }
  L.push(
    `- Top shows: ${!topShows ? "no reading" : topShows.length ? topShows.map((s) => `${cell(titleOf(s.episodeId), 48)} (${s.plays})`).join("; ") : "none"}.`,
  );
  L.push(
    !places
      ? "- Callers: no reading."
      : `- Callers: ${fmtN(places.calls)} calls from ${fmtN(places.callers)} callers. Calling from: ${
          places.top.length ? places.top.map((p) => `${cell(p.place, 30)} ${p.calls}`).join(", ") : "nobody said"
        }${places.unplaced ? ` (${places.unplaced} calls gave no place)` : ""}.`,
  );
  L.push("");

  L.push("## Health");
  L.push("");
  const notOk = status.filter((l) => l.level !== "OK");
  if (!status.length) L.push("- highdesert-status gave no lines.");
  else if (!notOk.length) L.push(`- highdesert-status: all ${status.length} checks OK.`);
  else for (const l of notOk) L.push(`- ${l.level} ${l.area}: ${cell(l.text, 150)}`);
  const mirror = status.find((l) => l.area === "mirror");
  const cpu = status.find((l) => l.area === "cpu");
  const pins = /(\d+) pinned \(([\d.]+ GB)\)/.exec(mirror?.text ?? "");
  const cpuHi = /highest: ([^)]+)\)/.exec(cpu?.text ?? "");
  L.push(
    `- Disk: ${disk ? `${disk.usedPct}% used, ${disk.freeGb} GB free` : "no reading"}. Pins: ${pins ? `${pins[1]} shows (${pins[2]})` : "no reading"}. CPU: ${
      cpuHi ? `busiest unit ${cpuHi[1]} of a core` : cpu ? cell(cpu.text, 80) : "no reading"
    }.`,
  );

  if (evidence) {
    L.push("");
    L.push("---");
    L.push("");
    L.push("## Evidence for a fix session");
    L.push("");
    for (const r of evidence.reasons) L.push(`- ${cell(r.text, 220)}`);
    L.push("");
    L.push(`### The rows (${evidence.rows.length} of ${evidence.total}, newest first)`);
    L.push("");
    if (evidence.rows.length) {
      L.push("| When (UTC) | Kind | Device | Source | Recovered | Show | Detail |");
      L.push("|---|---|---|---|---|---|---|");
      for (const r of evidence.rows) {
        L.push(
          `| ${new Date(r.at).toISOString().slice(5, 16).replace("T", " ")} | ${cell(r.kind, 20)} | ${cell(r.uaClass, 16)} | ${cell(r.source ?? "unknown", 8)} | ${r.recovered ? "yes" : "no"} | ${cell(titleOf(r.episodeId), 40)} | ${cell(r.detail, 60)} |`,
        );
      }
    } else {
      L.push("No failure rows on this release's builds.");
    }
    L.push("");
    L.push("### The pattern");
    L.push("");
    for (const l of evidence.pattern.lines) L.push(`- ${l}`);
    L.push("");
    L.push("### Proposed fix");
    L.push("");
    for (const l of evidence.fix) L.push(`- ${l}`);
  }
  L.push("");
  // User-facing copy: never an em dash, whatever came in from a title or a status line.
  return L.join("\n").replace(/\u2014/g, ",");
}

/** The main part's height: everything above the evidence. */
export function screenLines(md) {
  const cut = md.indexOf("\n---\n");
  return (cut < 0 ? md : md.slice(0, cut)).trimEnd().split("\n").length;
}

// ---------------------------------------------------------------------------
// Gathering the week
// ---------------------------------------------------------------------------

function sh(cmd, args, opts = {}) {
  return new Promise((resolve, reject) =>
    execFile(cmd, args, { timeout: 120_000, ...opts }, (err, out, errOut) =>
      err ? reject(Object.assign(new Error(`${cmd} ${args.join(" ")}: ${(errOut || err.message).trim()}`), { stdout: out })) : resolve(out.trim()),
    ),
  );
}

async function readText(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
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

/** fileHash-free catalog lookup: the community key (src/lib/utils/community-key.ts) to a title. */
export function titleIndex(catalogJson) {
  const m = new Map();
  for (const e of Array.isArray(catalogJson) ? catalogJson : []) {
    if (!e?.archiveIdentifier || !e?.fileName) continue;
    const key = `${e.archiveIdentifier}--${String(e.fileName).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 120)}`;
    m.set(key, e.title || key);
  }
  return (id) => m.get(id) ?? id;
}

/** The real sources. Each returns what it can; a missing source is said in the digest, not fatal. */
export function productionSources(env) {
  const root = env.HD_ROOT ?? "/root/High-Desert";
  const api = env.HD_API ?? "http://127.0.0.1:3003";
  let poolP = null;
  const db = async () => {
    if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
    if (!poolP) poolP = import("pg").then(({ default: pg }) => new pg.Pool({ connectionString: env.DATABASE_URL, max: 1 }));
    return poolP;
  };
  const q = async (sql, params) => (await (await db()).query(sql, params)).rows;
  return {
    async status() {
      try {
        return await sh(env.HD_STATUS_CMD ?? "highdesert-status", [], { timeout: 600_000 });
      } catch (err) {
        return err.stdout ?? ""; // non-zero on any FAIL: the lines are still the answer
      }
    },
    async traffic() {
      const res = await fetch(`${api}/api/stats/traffic?range=7d`);
      return res.ok ? res.json() : null;
    },
    async funnel() {
      return readJson(env.HD_FUNNEL_STATUS ?? "/var/lib/highdesert-funnel/status.json");
    },
    async baseline() {
      return { doc: await readText(path.join(root, "docs/reliability-baseline.md")), history: await readText(path.join(root, ".deploy/history")) };
    },
    async catalog() {
      return JSON.parse((await readText(path.join(root, "public/seed/library.json"))) ?? "[]");
    },
    async disk() {
      const out = await sh("df", ["-P", "-k", "/"]);
      const f = out.split("\n")[1]?.trim().split(/\s+/) ?? [];
      return { usedPct: Number(String(f[4]).replace("%", "")), freeGb: Math.round(Number(f[3]) / 1024 / 1024) };
    },
    async topShows(since) {
      return (
        await q(
          `SELECT episode_id AS "episodeId", count(*)::int AS plays FROM play_events
            WHERE played_at >= $1 GROUP BY episode_id ORDER BY plays DESC, episode_id LIMIT 5`,
          [since],
        )
      );
    },
    async places(since) {
      const [t] = await q(
        `SELECT count(*)::int AS calls, count(DISTINCT client_ref)::int AS callers,
                count(*) FILTER (WHERE caller_place IS NULL OR caller_place = '')::int AS unplaced
           FROM live_messages WHERE at >= $1`,
        [since],
      );
      const top = await q(
        `SELECT caller_place AS place, count(*)::int AS calls FROM live_messages
          WHERE at >= $1 AND caller_place <> '' GROUP BY caller_place ORDER BY calls DESC, place LIMIT 6`,
        [since],
      );
      return { ...t, top };
    },
    async failures(since) {
      return q(
        `SELECT id, at, episode_id AS "episodeId", kind, retried, recovered, ua_class AS "uaClass", detail, source, build
           FROM playback_failures WHERE at >= $1 AND NOT (kind = ANY($2)) ORDER BY at DESC LIMIT 2000`,
        [since, ADVISORY_KINDS],
      );
    },
    async close() {
      if (poolP) await (await poolP).end();
    },
  };
}

/** Everything the digest says, from the sources. */
export async function gather(sources, now) {
  const weekAgo = new Date(new Date(now).getTime() - 7 * 86_400_000).toISOString();
  // A source that fails is named in the digest, never passed off as "none".
  const missing = [];
  const safe = async (name, fn, fallback) => {
    try {
      return await fn();
    } catch {
      missing.push(name);
      return fallback;
    }
  };
  const status = parseStatus(await safe("highdesert-status", () => sources.status(), ""));
  const release = parseRelease(status.find((l) => l.area === "release"));
  const { doc, history } = await safe("the release doc", () => sources.baseline(), { doc: null, history: null });
  const rel = releaseBuilds(doc, history);
  const titleOf = titleIndex(await safe("the catalog", () => sources.catalog(), []));
  const read = await safe("failure rows", () => sources.failures(rel.at && rel.at < weekAgo ? rel.at : weekAgo), null);
  const failures = read ?? [];
  const weekFailures = failures.filter((r) => new Date(r.at).toISOString() >= weekAgo);
  const handover = read
    ? lockedPhones(weekFailures.filter((r) => r.kind === "handover-rejected"))
    : { lines: ["No reading: the failure rows could not be read."], hiddenShare: 0, n: 0 };
  const reasons = evidenceReasons(status, release);
  let evidence = null;
  if (reasons.length) {
    // The release's own rows when that is the question; otherwise the week's.
    const releaseRows = rel.at ? failures.filter((r) => new Date(r.at).toISOString() >= rel.at && isReleaseBuild(r.build, rel.builds)) : [];
    const rows = reasons.some((r) => r.area === "release") && releaseRows.length ? releaseRows : weekFailures;
    const pattern = patternOf(rows, titleOf);
    evidence = { reasons, total: rows.length, rows: rows.slice(0, 15), pattern, fix: [...proposeFix(pattern, titleOf), ...reasons.filter((r) => FAIL_ACTIONS[r.area] && r.area !== "release").map((r) => `${r.area}: ${FAIL_ACTIONS[r.area]}`)] };
  }
  return {
    status,
    release,
    funnel: await safe("the funnel job", () => sources.funnel(), null),
    handover,
    traffic: await safe("traffic", () => sources.traffic(), null),
    topShows: await safe("plays", () => sources.topShows(weekAgo), null),
    places: await safe("the phone lines", () => sources.places(weekAgo), null),
    disk: await safe("disk", () => sources.disk(), null),
    evidence,
    titleOf,
    missing,
  };
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

/** Commit docs/digest/<day>.md on main from the job's own checkout. Never overwrites a week. */
async function publish(state, day, render, remote) {
  const repo = path.join(state, "repo");
  const git = (...a) => sh("git", ["-C", repo, "-c", `user.name=${AUTHOR.name}`, "-c", `user.email=${AUTHOR.email}`, ...a]);
  if (!existsSync(path.join(repo, ".git"))) await sh("git", ["clone", "-q", remote, repo]);
  await git("fetch", "-q", "origin", "main");
  await git("checkout", "-q", "--detach", "origin/main");
  const rel = `${DIGEST_DIR}/${day}.md`;
  const file = path.join(repo, rel);
  if (!existsSync(file)) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, await render());
    await git("add", rel);
    await git("commit", "-q", "-m", `docs(digest): the week to ${day}, written by the digest job`);
    // --no-verify: a machine-made push of one doc from a checkout with no
    // node_modules; no hook the box might carry can run in it.
    await git("push", "-q", "--no-verify", "origin", "HEAD:main");
  }
  return { sha: await git("rev-parse", "--short", "HEAD"), file };
}

export async function main(env = process.env, sources = productionSources(env)) {
  const state = env.HD_DIGEST_STATE ?? "/var/lib/highdesert-digest";
  const macDest = env.HD_DIGEST_MAC_DEST ?? "macbook:Downloads/high-desert-digest/";
  const now = env.HD_NOW ?? new Date().toISOString();
  await mkdir(state, { recursive: true });
  const statusFile = path.join(state, "status.json");
  const st = (await readJson(statusFile)) ?? {};
  st.checkedAt = now;
  st.error = null;
  st.written ??= {};
  st.copied ??= {};
  const day = dueDay(now);
  st.due = day >= FIRST_DUE ? day : null;
  st.firstDue = FIRST_DUE;

  try {
    if (st.due && !st.written[day]) {
      const remote = env.HD_DIGEST_REMOTE ?? (await sh("git", ["-C", env.HD_ROOT ?? "/root/High-Desert", "remote", "get-url", "origin"]));
      let summary = null;
      const { sha } = await publish(
        state,
        day,
        async () => {
          const d = await gather(sources, now);
          summary = {
            fails: d.status.filter((l) => l.level === "FAIL").map((l) => l.area),
            release: d.release && { pct: d.release.pct, plays: d.release.plays, verdict: releaseVerdict(d.release) },
            evidence: !!d.evidence,
          };
          return render({ day, writtenAt: now, ...d });
        },
        remote,
      );
      st.written[day] = { sha, at: now, ...(summary ? { summary } : { note: "already on main" }) };
    }
    for (const d of Object.keys(st.written).sort()) {
      if (st.copied[d]) continue;
      const doc = path.join(state, "repo", DIGEST_DIR, `${d}.md`);
      if (!existsSync(doc)) continue;
      const [host, dir] = macDest.split(":");
      await sh(env.HD_SSH ?? "ssh", ["-o", "ConnectTimeout=10", host, `mkdir -p ${JSON.stringify(dir)}`]);
      await sh(env.HD_SCP ?? "scp", ["-o", "ConnectTimeout=10", doc, macDest]);
      st.copied[d] = now;
    }
  } catch (err) {
    st.error = String(err.message ?? err).slice(0, 300);
  } finally {
    await sources.close?.();
  }
  await writeJson(statusFile, st);
  return st;
}

/** `--preview <file>`: gather and render now, into <file>. No git, no state, no copy. */
export async function preview(file, env = process.env, sources = productionSources(env)) {
  const now = env.HD_NOW ?? new Date().toISOString();
  try {
    const d = await gather(sources, now);
    const md = render({ day: dueDay(now), writtenAt: now, ...d });
    await writeFile(file, md);
    return md;
  } finally {
    await sources.close?.();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--preview") {
  await preview(process.argv[3] ?? "/dev/stdout");
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await main();
  console.log(JSON.stringify({ due: s.due, written: s.due ? (s.written[s.due] ?? null) : null, copied: s.due ? (s.copied[s.due] ?? null) : null, error: s.error }));
  // A Mac that is asleep is normal; anything else wants attention.
  process.exit(s.error && !(s.written[s.due] && /ssh|scp/.test(s.error)) ? 1 : 0);
}
