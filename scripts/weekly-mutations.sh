#!/usr/bin/env bash
#
# The nightly mutation run on the VPS (the lead for Jackson, 2026-11-27; it was
# the weekly full run from 2026-10-15, and keeps the file and unit names):
# honest but cheap.
#
# - Incremental by default: the mutations whose target or test changed since
#   the last green run (every mutation red), plus those whose test can see a
#   change through its imports (scripts/lib/import-closure.mjs), plus any entry
#   new or edited since, plus the last run's survivors (re-checked until they
#   go red or leave the list). mutate-check --changed-from <green> --also <ids>.
# - A full run once a month: when the last full run finished over
#   HD_MUTATIONS_FULL_DAYS (30) days ago, or there is none, or the green head
#   is not an ancestor of main (history rewritten), the night checks all of it.
#   A full run that did not finish (the unit's 16h, a kill) is tried again
#   after HD_MUTATIONS_FULL_RETRY_DAYS (7); the nights between stay
#   incremental, so an unfinishable full run cannot hold the box every night.
# - The cap is the unit's (deploy/highdesert-mutations.service): CPUQuota=150%,
#   Nice=19, idle IO. Each mutation's vitest is one test file (one worker,
#   --maxWorkers=2 at most) through heavy's low lane, so it waits while anyone
#   else's job waits, and heavy holds it through peak hours.
#
# It never runs in the production tree: mutate-check edits the files it breaks,
# so it works in its own clone under $STATE/checkout, reset to main each run,
# with its own node_modules (installed only when the lockfile changes).
#
# What it leaves (read by highdesert-status's `mutations` line and the digest):
#   $STATE/running.json  {startedAt, pid, head, mode} while a run is going
#   $STATE/result.json   the newest finished run: mutate-check's --json verdicts
#                        plus {head, mode, base, error, log}; `error` set when
#                        it broke before checking anything. Status reads only
#                        this, so an id from an older run cannot hold a FAIL.
#   $STATE/green.json    {head, finishedAt} of the newest run with every
#                        checked mutation red: the next incremental run's base
#   $STATE/full.json     the newest full run's result (the monthly score)
#   $STATE/full-tried.json  {startedAt, head} of a full run started and not
#                        finished (removed when one finishes)
#   $STATE/runs/<startedAt>.json  every result, the last 8 kept
#   $STATE/last.log      the run's output
#
# Env: HD_MUTATIONS_STATE (/var/lib/highdesert-mutations), HD_MUTATIONS_SRC (the
# repo to clone: /root/High-Desert), HD_MUTATIONS_MODE (auto, full or
# incremental), HD_MUTATIONS_FULL_DAYS (30), HD_MUTATIONS_FULL_RETRY_DAYS (7),
# HD_MUTATIONS_ARGS (extra
# mutate-check arguments, for tests: an id substring), TEST_DATABASE_URL (from
# the unit's EnvironmentFile; without it the database mutations are NOT
# CHECKED and the status line says so).
# Exit: 0 every mutation red, 1 a mutation survived or went stale, 2 broke first.
set -uo pipefail
for v in $(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
unset CI

STATE="${HD_MUTATIONS_STATE:-/var/lib/highdesert-mutations}"
SRC="${HD_MUTATIONS_SRC:-/root/High-Desert}"
CHECKOUT="$STATE/checkout"
LOG="$STATE/last.log"
HEAVY="$(command -v heavy || true)"
MODE="${HD_MUTATIONS_MODE:-auto}"
FULL_DAYS="${HD_MUTATIONS_FULL_DAYS:-30}"
FULL_RETRY_DAYS="${HD_MUTATIONS_FULL_RETRY_DAYS:-7}"
mkdir -p "$STATE/runs"
mode=""; base=""; why=""

started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
head=""
: > "$LOG"
jq -n --arg s "$started" --argjson p $$ '{startedAt: $s, pid: $p, head: null}' > "$STATE/running.json"
trap 'rm -f "$STATE/running.json"' EXIT

# Write result.json whole (temp + rename): a reader never sees half of one.
finish() { # <exit> <error or empty> [mutate-check json]
  local body="${3:-}"
  [[ -n "$body" ]] || body="$(jq -n --arg s "$started" '{startedAt: $s, finishedAt: (now | todate), total: 0, red: 0, skipped: [], survived: []}')"
  jq --arg head "$head" --arg err "$2" --arg log "$LOG" --argjson exit "$1" \
    --arg started "$started" --arg mode "$mode" --arg base "$base" --arg why "$why" \
    '. + {startedAt: $started, finishedAt: (.finishedAt | sub("\\.[0-9]+Z$"; "Z")), head: (if $head == "" then null else $head end), mode: (if $mode == "" then null else $mode end), base: (if $base == "" then null else $base end), why: (if $why == "" then null else $why end), error: (if $err == "" then null else $err end), log: $log, exit: $exit}' \
    <<<"$body" > "$STATE/result.json.tmp" && mv "$STATE/result.json.tmp" "$STATE/result.json"
  cp "$STATE/result.json" "$STATE/runs/$started.json"
  if [[ -z "$2" ]]; then
    # The next night's base, and the month's full score.
    if [[ "$1" == 0 ]]; then
      jq '{head, finishedAt}' "$STATE/result.json" > "$STATE/green.json.tmp" && mv "$STATE/green.json.tmp" "$STATE/green.json"
    fi
    if [[ "$mode" == full ]]; then
      cp "$STATE/result.json" "$STATE/full.json.tmp" && mv "$STATE/full.json.tmp" "$STATE/full.json"
      rm -f "$STATE/full-tried.json" # finished: only an unfinished full run waits out the retry
    fi
  fi
  ls -1 "$STATE/runs" | sort | head -n -8 | while read -r f; do rm -f "$STATE/runs/$f"; done
  exit "$1"
}
broke() { echo "weekly-mutations: $1" >> "$LOG"; finish 2 "$1"; }
step() { echo "== $*" >> "$LOG"; }
heavy_run() { # <label> <cmd...>: through heavy where it exists (it always does here)
  local label="$1"; shift
  if [[ -n "$HEAVY" ]]; then "$HEAVY" --label "$label" -- "$@"; else "$@"; fi
}

step "checkout of $SRC main"
if [[ ! -d "$CHECKOUT/.git" ]]; then
  git clone -q --no-hardlinks "$SRC" "$CHECKOUT" >> "$LOG" 2>&1 || broke "could not clone $SRC"
fi
git -C "$CHECKOUT" fetch -q origin main >> "$LOG" 2>&1 || broke "could not fetch main from $SRC"
git -C "$CHECKOUT" checkout -q --detach origin/main >> "$LOG" 2>&1 || broke "could not check out main"
git -C "$CHECKOUT" reset -q --hard origin/main >> "$LOG" 2>&1 || broke "could not reset to main"
git -C "$CHECKOUT" clean -fdxq -e node_modules -e /services/live/node_modules >> "$LOG" 2>&1 || broke "could not clean the checkout"
head="$(git -C "$CHECKOUT" rev-parse HEAD)"
jq --arg h "$head" '.head = $h' "$STATE/running.json" > "$STATE/running.json.tmp" && mv "$STATE/running.json.tmp" "$STATE/running.json"

# Dependencies: only when a lockfile changed since the last install.
install() { # <dir> <label>
  local dir="$1" stamp="$1/node_modules/.weekly-mutations-lock"
  local want; want="$(sha256sum "$dir/package-lock.json" | cut -d' ' -f1)"
  if [[ -d "$dir/node_modules" && "$(cat "$stamp" 2>/dev/null)" == "$want" ]]; then return 0; fi
  step "npm ci in $dir"
  (cd "$dir" && heavy_run "$2" npm ci --no-audit --no-fund) >> "$LOG" 2>&1 || return 1
  echo "$want" > "$stamp"
}
install "$CHECKOUT" "high-desert weekly mutations: npm ci" || broke "npm ci failed in the checkout"
install "$CHECKOUT/services/live" "high-desert weekly mutations: npm ci (live)" || broke "npm ci failed in services/live"

# The test database's schema, as CI applied it (idempotent). Only the *_test
# database: src/test-support/test-db.ts refuses anything else, and so does this.
if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  [[ "$TEST_DATABASE_URL" =~ _test(\?|$) ]] || broke "TEST_DATABASE_URL is not a *_test database"
  step "schema into the test database"
  for f in scripts/schema.sql services/live/schema.sql; do
    psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -q -f "$CHECKOUT/$f" >> "$LOG" 2>&1 || broke "could not apply $f to the test database"
  done
fi

# Incremental or full (see the top). The base is the newest green head, else
# the newest finished run's head (its survivors are carried); a base main no
# longer contains means history moved, and the night checks everything.
days_since() { # <ISO time> -> whole days, or empty
  local t; t="$(date -d "$1" +%s 2>/dev/null)" || return 0
  echo $(( ($(date +%s) - t) / 86400 ))
}
prev_head="$(jq -r '.head // empty' "$STATE/result.json" 2>/dev/null)"
prev_error="$(jq -r '.error // empty' "$STATE/result.json" 2>/dev/null)"
carry="$(jq -r '[.survived[]?.id] | join(",")' "$STATE/result.json" 2>/dev/null)"
green="$(jq -r '.head // empty' "$STATE/green.json" 2>/dev/null)"
full_at="$(jq -r '.finishedAt // empty' "$STATE/full.json" 2>/dev/null)"
full_age="$( [[ -n "$full_at" ]] && days_since "$full_at")"
tried_at="$(jq -r '.startedAt // empty' "$STATE/full-tried.json" 2>/dev/null)"
tried_age="$( [[ -n "$tried_at" ]] && days_since "$tried_at")"
mode="$MODE"
if [[ "$mode" == auto ]]; then
  if [[ -n "$full_age" ]] && (( full_age < FULL_DAYS )); then
    mode=incremental
  elif [[ -n "$tried_age" && ( -z "$full_at" || "$tried_at" > "$full_at" ) ]] && (( tried_age < FULL_RETRY_DAYS )); then
    mode=incremental # a full run started ${tried_age}d ago and did not finish: retried after FULL_RETRY_DAYS
  elif [[ -z "$full_age" ]]; then
    mode=full; why="no full run on record"
  else
    mode=full; why="the last full run finished ${full_age}d ago (every ${FULL_DAYS}d)"
  fi
fi
if [[ "$mode" == incremental ]]; then
  base="$green"
  [[ -n "$base" ]] || { [[ -z "$prev_error" ]] && base="$prev_head"; }
  if [[ -z "$base" ]]; then
    mode=full; why="no earlier run to start from"; base=""
  elif ! git -C "$CHECKOUT" merge-base --is-ancestor "$base" "$head" 2>/dev/null; then
    mode=full; why="the base ${base:0:7} is not in main's history"; base=""
  else
    why="changed since ${base:0:7}${carry:+, with the previous survivors}"
  fi
fi
args=()
[[ "$mode" == full ]] && jq -n --arg s "$started" --arg h "$head" '{startedAt: $s, head: $h}' > "$STATE/full-tried.json"
if [[ "$mode" == incremental ]]; then
  args+=(--changed-from "$base")
  [[ -n "$carry" ]] && args+=(--also "$carry")
fi
jq --arg m "$mode" '.mode = $m' "$STATE/running.json" > "$STATE/running.json.tmp" && mv "$STATE/running.json.tmp" "$STATE/running.json"

rm -f "$STATE/mutate.json"
step "mutate-check on $head: $mode${why:+ ($why)}"
# shellcheck disable=SC2086 # HD_MUTATIONS_ARGS is words on purpose
(cd "$CHECKOUT" && node scripts/mutate-check.mjs --json "$STATE/mutate.json" "${args[@]}" ${HD_MUTATIONS_ARGS:-}) >> "$LOG" 2>&1
rc=$?
if [[ ! -s "$STATE/mutate.json" ]] || (( rc > 1 )); then
  rm -f "$STATE/mutate.json"
  broke "mutate-check exited $rc without a verdict (see $LOG)"
fi
body="$(cat "$STATE/mutate.json")"; rm -f "$STATE/mutate.json"
finish "$rc" "" "$body"
