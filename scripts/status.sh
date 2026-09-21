#!/usr/bin/env bash
#
# One command for "is High Desert healthy?". Installed on PATH as
# `highdesert-status` (a wrapper in /root/vps-tools/bin). Run it at the start
# of a session, alongside repo-bundle-status and sogojet-deploy-status.
#
# Each line is OK, WARN or FAIL. Exits non-zero if any line is FAIL.
#
#   deploy    the deployed commit (.deploy/deployed) vs HEAD, and HEAD vs origin
#   service   highdesert.service active, and the installed unit == deploy/highdesert.service
#   backup    highdesert-backup-status (OK / FAILED / STALE after 36h)
#   sampler   highdesert-sample.timer active and its last run succeeded recently
#   failures  7-day failed-start rate from /api/stats/failures vs plays from /api/stats/traffic
#   audit     npm audit --omit=dev critical + high count
#
# The failure rate is reported, not judged: WARN above 10%, never FAIL — it
# is a product metric, and a bad week of archive.org is not an outage here.
#
# Overridable for scripts/__tests__/status.test.ts:
#   HD_ROOT, HD_API (http://127.0.0.1:3003), HD_SYSTEMCTL, HD_NPM,
#   HD_BACKUP_STATUS_CMD, HD_INSTALLED_UNIT, HD_SAMPLER_MAX_AGE_S (600)
set -uo pipefail

ROOT="${HD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
API="${HD_API:-http://127.0.0.1:3003}"
SYSTEMCTL="${HD_SYSTEMCTL:-systemctl}"
NPM="${HD_NPM:-npm}"
BACKUP_STATUS_CMD="${HD_BACKUP_STATUS_CMD:-bash $ROOT/scripts/backup-status.sh}"
INSTALLED_UNIT="${HD_INSTALLED_UNIT:-/etc/systemd/system/highdesert.service}"
SAMPLER_MAX_AGE_S="${HD_SAMPLER_MAX_AGE_S:-600}"

cd "$ROOT" || exit 2

FAILS=0
line() {
  local level="$1" area="$2"
  shift 2
  printf '%-4s  %-9s %s\n' "$level" "$area" "$*"
  [[ "$level" == FAIL ]] && FAILS=$((FAILS + 1))
  return 0
}

# --- deploy ------------------------------------------------------------------
head_ref="$(git rev-parse --short HEAD 2>/dev/null)"
deployed_ref="$(cut -d' ' -f1 .deploy/deployed 2>/dev/null)"
deployed_at="$(cut -d' ' -f2 .deploy/deployed 2>/dev/null)"
if [[ -z "$deployed_ref" ]]; then
  line FAIL deploy "no .deploy/deployed — nothing has been deployed with scripts/deploy.sh"
elif [[ "$deployed_ref" != "$head_ref" ]]; then
  behind="$(git rev-list --count "$deployed_ref..HEAD" 2>/dev/null || echo '?')"
  line FAIL deploy "DRIFT: live is $deployed_ref ($deployed_at), HEAD is $head_ref — $behind commit(s) not deployed"
else
  line OK deploy "live = HEAD = $head_ref (deployed $deployed_at)"
fi
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  line WARN deploy "working tree has uncommitted changes"
fi
if upstream="$(git rev-parse --short '@{u}' 2>/dev/null)"; then
  ahead="$(git rev-list --count '@{u}..HEAD' 2>/dev/null || echo 0)"
  if (( ahead > 0 )); then
    line WARN deploy "$ahead commit(s) not pushed to $(git rev-parse --abbrev-ref '@{u}')"
  fi
fi

# --- service -----------------------------------------------------------------
if [[ "$("$SYSTEMCTL" is-active highdesert 2>/dev/null)" == active ]]; then
  if [[ -f "$INSTALLED_UNIT" ]] && ! cmp -s "$INSTALLED_UNIT" deploy/highdesert.service; then
    line WARN service "active, but $INSTALLED_UNIT differs from deploy/highdesert.service"
  else
    line OK service "highdesert active"
  fi
else
  line FAIL service "highdesert is not active"
fi

# --- backup ------------------------------------------------------------------
backup_out="$($BACKUP_STATUS_CMD 2>&1)"
backup_rc=$?
if (( backup_rc == 0 )); then
  line OK backup "$(head -1 <<<"$backup_out")"
else
  line FAIL backup "$(head -1 <<<"$backup_out")"
fi

# --- sampler -----------------------------------------------------------------
timer_state="$("$SYSTEMCTL" show highdesert-sample.timer -p ActiveState --value 2>/dev/null)"
last_trigger="$("$SYSTEMCTL" show highdesert-sample.timer -p LastTriggerUSec --value 2>/dev/null)"
last_result="$("$SYSTEMCTL" show highdesert-sample.service -p Result --value 2>/dev/null)"
last_epoch="$(date -d "$last_trigger" +%s 2>/dev/null || echo 0)"
age_s=$(( $(date +%s) - last_epoch ))
if [[ "$timer_state" != active ]]; then
  line FAIL sampler "highdesert-sample.timer is ${timer_state:-unknown} — no traffic history is being recorded"
elif (( last_epoch == 0 || age_s > SAMPLER_MAX_AGE_S )); then
  line FAIL sampler "last sample ${last_trigger:-never} (${age_s}s ago, expected every 120s)"
elif [[ "$last_result" != success ]]; then
  line FAIL sampler "last sample run result: $last_result"
else
  line OK sampler "timer active, last sample ${age_s}s ago"
fi

# --- failures ----------------------------------------------------------------
failures_json="$(curl -s --max-time 10 "$API/api/stats/failures?days=7" 2>/dev/null)"
traffic_json="$(curl -s --max-time 10 "$API/api/stats/traffic?range=7d" 2>/dev/null)"
failures="$(jq -r '.summary.failures // empty' <<<"$failures_json" 2>/dev/null)"
plays="$(jq -r '.playsInRange // empty' <<<"$traffic_json" 2>/dev/null)"
if [[ -z "$failures" || -z "$plays" ]]; then
  line FAIL failures "could not read /api/stats/failures or /api/stats/traffic from $API"
elif (( plays == 0 )); then
  line WARN failures "$failures failed start(s) and no plays in 7 days"
else
  pct="$(awk -v f="$failures" -v p="$plays" 'BEGIN { printf "%.1f", 100 * f / p }')"
  level=OK
  awk -v x="$pct" 'BEGIN { exit !(x > 10) }' && level=WARN
  line "$level" failures "${pct}% of starts failed in 7 days ($failures failures / $plays plays)"
fi

# --- audit -------------------------------------------------------------------
audit_json="$("$NPM" audit --omit=dev --json 2>/dev/null)"
crit="$(jq -r '.metadata.vulnerabilities.critical // empty' <<<"$audit_json" 2>/dev/null)"
high="$(jq -r '.metadata.vulnerabilities.high // empty' <<<"$audit_json" 2>/dev/null)"
if [[ -z "$crit" || -z "$high" ]]; then
  line WARN audit "npm audit did not answer (offline?)"
elif (( crit + high > 0 )); then
  line FAIL audit "npm audit --omit=dev: $crit critical, $high high (see docs/security-exceptions.md)"
else
  line OK audit "npm audit --omit=dev: 0 critical, 0 high"
fi

exit $(( FAILS > 0 ))
