#!/usr/bin/env bash
#
# The weekly full mutation run on the VPS (Jackson, 2026-10-15): every entry in
# scripts/mutate-check.mjs against main, Mondays 14:00 UTC
# (deploy/highdesert-mutations.timer). It replaced the nightly GitHub run when
# checks moved off GitHub Actions.
#
# It never runs in the production tree: mutate-check edits the files it breaks,
# so it works in its own clone under $STATE/checkout, reset to main each run,
# with its own node_modules (installed only when the lockfile changes).
#
# Each mutation's vitest takes the box-wide `heavy` slot (mutate-check does that
# itself), so the CPU gate is checked before every one and other sessions' jobs
# take turns with it. The unit has no CPUQuota: Jackson exempted this one job
# from the 10% rule, and highdesert-status's cpu line names it as the exemption.
#
# What it leaves (read by highdesert-status's `mutations` line and the digest):
#   $STATE/running.json  {startedAt, pid, head} while a run is going
#   $STATE/result.json   the last finished run: mutate-check's --json verdicts
#                        plus {head, error, log}; `error` set when it broke
#                        before checking anything
#   $STATE/runs/<startedAt>.json  the same, the last 8 kept
#   $STATE/last.log      the run's output
#
# Env: HD_MUTATIONS_STATE (/var/lib/highdesert-mutations), HD_MUTATIONS_SRC (the
# repo to clone: /root/High-Desert), HD_MUTATIONS_ARGS (extra mutate-check
# arguments, for tests: an id substring), TEST_DATABASE_URL (from the unit's
# EnvironmentFile; without it the database mutations are NOT CHECKED and the
# status line says so).
# Exit: 0 every mutation red, 1 a mutation survived or went stale, 2 broke first.
set -uo pipefail
for v in $(env | sed -n 's/^\(GIT_[A-Z_]*\)=.*/\1/p'); do unset "$v"; done
unset CI

STATE="${HD_MUTATIONS_STATE:-/var/lib/highdesert-mutations}"
SRC="${HD_MUTATIONS_SRC:-/root/High-Desert}"
CHECKOUT="$STATE/checkout"
LOG="$STATE/last.log"
HEAVY="$(command -v heavy || true)"
mkdir -p "$STATE/runs"

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
    --arg started "$started" \
    '. + {startedAt: $started, finishedAt: (.finishedAt | sub("\\.[0-9]+Z$"; "Z")), head: (if $head == "" then null else $head end), error: (if $err == "" then null else $err end), log: $log, exit: $exit}' \
    <<<"$body" > "$STATE/result.json.tmp" && mv "$STATE/result.json.tmp" "$STATE/result.json"
  cp "$STATE/result.json" "$STATE/runs/$started.json"
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

rm -f "$STATE/mutate.json"
step "mutate-check on $head"
# shellcheck disable=SC2086 # HD_MUTATIONS_ARGS is words on purpose
(cd "$CHECKOUT" && node scripts/mutate-check.mjs --json "$STATE/mutate.json" ${HD_MUTATIONS_ARGS:-}) >> "$LOG" 2>&1
rc=$?
if [[ ! -s "$STATE/mutate.json" ]] || (( rc > 1 )); then
  rm -f "$STATE/mutate.json"
  broke "mutate-check exited $rc without a verdict (see $LOG)"
fi
body="$(cat "$STATE/mutate.json")"; rm -f "$STATE/mutate.json"
finish "$rc" "" "$body"
