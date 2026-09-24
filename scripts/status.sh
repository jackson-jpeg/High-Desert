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
#   nginx     the installed vhost == deploy/nginx/highdesert.conf (WARN on drift:
#             the stats write limit and the X-Forwarded-For overwrite live there)
#   backup    highdesert-backup-status (OK / FAILED / STALE after 36h)
#   sampler   highdesert-sample.timer active and its last run succeeded recently
#   failures  7-day failed-start rate from /api/stats/failures vs plays from /api/stats/traffic
#   release   failed-start rate over the 7 days after the release recorded in
#             docs/reliability-baseline.md (/api/stats/failures?since=), WARN at 3%+
#   presence  the live site's presence surfaces (Stats badge, status bar, mobile
#             sheet, On Air, Signal Traffic) show the same numbers within one
#             poll — scripts/presence-check.mjs in headless Chromium; FAIL if not
#   audit     npm audit --omit=dev critical + high count
#
# The failure rate is reported, not judged: WARN above 10%, never FAIL — it
# is a product metric, and a bad week of archive.org is not an outage here.
# The release line is the same kind of number held to a tighter target: the
# trailing rate still carries the old build for a week after a deploy, so it
# cannot say whether the deploy helped.
#
# Overridable for scripts/__tests__/status.test.ts:
#   HD_ROOT, HD_API (http://127.0.0.1:3003), HD_SYSTEMCTL, HD_NPM,
#   HD_BACKUP_STATUS_CMD, HD_INSTALLED_UNIT, HD_INSTALLED_VHOST, HD_SAMPLER_MAX_AGE_S (600),
#   HD_PRESENCE_CMD, HD_SITE (https://highdesert.space)
set -uo pipefail

ROOT="${HD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
API="${HD_API:-http://127.0.0.1:3003}"
SYSTEMCTL="${HD_SYSTEMCTL:-systemctl}"
NPM="${HD_NPM:-npm}"
BACKUP_STATUS_CMD="${HD_BACKUP_STATUS_CMD:-bash $ROOT/scripts/backup-status.sh}"
INSTALLED_UNIT="${HD_INSTALLED_UNIT:-/etc/systemd/system/highdesert.service}"
INSTALLED_VHOST="${HD_INSTALLED_VHOST:-/etc/nginx/sites-available/highdesert}"
SAMPLER_MAX_AGE_S="${HD_SAMPLER_MAX_AGE_S:-600}"
SITE="${HD_SITE:-https://highdesert.space}"
PRESENCE_CMD="${HD_PRESENCE_CMD:-timeout 120 nice -n 10 node $ROOT/scripts/presence-check.mjs $SITE}"

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

# --- nginx -------------------------------------------------------------------
# WARN, not FAIL, like the unit: drift is a change someone has not finished
# applying, not an outage. It is still worth a line, because this file is where
# the outer rate limit on the stats writes lives (HD-007), and a vhost edited
# by hand in /etc is exactly the kind of change nothing else would notice.
if [[ ! -f "$INSTALLED_VHOST" ]]; then
  line WARN nginx "no vhost at $INSTALLED_VHOST"
elif cmp -s "$INSTALLED_VHOST" deploy/nginx/highdesert.conf; then
  line OK nginx "vhost matches deploy/nginx/highdesert.conf"
else
  line WARN nginx "$INSTALLED_VHOST differs from deploy/nginx/highdesert.conf"
fi

# --- backup ------------------------------------------------------------------
backup_out="$($BACKUP_STATUS_CMD 2>&1)"
backup_rc=$?
if (( backup_rc == 0 )); then
  line OK backup "$(head -1 <<<"$backup_out")"
  backup_warn="$(grep -m1 '^WARN' <<<"$backup_out" | sed 's/^WARN *//')"
  [[ -n "$backup_warn" ]] && line WARN backup "$backup_warn"
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

# --- release -----------------------------------------------------------------
RELEASE_TARGET_PCT=3
baseline_doc="docs/reliability-baseline.md"
release_at="$(sed -n 's/^\*\*Release deployed:\*\* `\([^`]*\)`.*/\1/p' "$baseline_doc" 2>/dev/null | head -1)"
if [[ -z "$release_at" ]]; then
  line WARN release "no '**Release deployed:**' timestamp in $baseline_doc"
else
  window_json="$(curl -s --max-time 10 "$API/api/stats/failures?days=7&since=$release_at" 2>/dev/null)"
  wf="$(jq -r '.window.failures // empty' <<<"$window_json" 2>/dev/null)"
  wp="$(jq -r '.window.plays // empty' <<<"$window_json" 2>/dev/null)"
  wdays="$(jq -r '((.window.to | sub("\\.[0-9]+Z$"; "Z") | fromdate) - (.window.from | sub("\\.[0-9]+Z$"; "Z") | fromdate)) / 86400 | . * 10 | floor / 10' <<<"$window_json" 2>/dev/null)"
  if [[ -z "$wf" || -z "$wp" || -z "$wdays" ]]; then
    line FAIL release "could not read /api/stats/failures?since=$release_at from $API"
  elif (( wp == 0 )); then
    line OK release "no plays yet since the release ($release_at); target <${RELEASE_TARGET_PCT}%"
  else
    rpct="$(awk -v f="$wf" -v p="$wp" 'BEGIN { printf "%.1f", 100 * f / p }')"
    level=OK
    awk -v x="$rpct" -v t="$RELEASE_TARGET_PCT" 'BEGIN { exit !(x >= t) }' && level=WARN
    line "$level" release "${rpct}% of starts failed in the ${wdays} of 7 days since $release_at ($wf failures / $wp plays; target <${RELEASE_TARGET_PCT}%)"
  fi
fi

# --- presence ----------------------------------------------------------------
# Exit 0 = the surfaces agree (or nobody else is here to compare), 1 = they
# disagree, anything else = the check itself could not run, which is a WARN:
# a missing browser is not evidence that the numbers are wrong.
presence_out="$($PRESENCE_CMD 2>&1)"
presence_rc=$?
presence_msg="$(tail -1 <<<"$presence_out")"
case "$presence_rc" in
  0) line OK presence "$presence_msg" ;;
  1) line FAIL presence "surfaces disagree: $presence_msg" ;;
  *) line WARN presence "check did not run (exit $presence_rc): ${presence_msg:-no output}" ;;
esac

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
