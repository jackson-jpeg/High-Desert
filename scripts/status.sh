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
#   steal     hypervisor steal, mean of sysstat's samples over the last 30 minutes:
#             WARN above 20%, FAIL above 50% (the 2026-09-22 episode ran ~90%)
#   mirror    the outage mirror as nginx serves it: /mirror/manifest answering with
#             at least one pin; pinned count and bytes, the fill cache's size, and
#             mirror plays in the last 24h. WARN if the retired webtorrent gateway
#             (highdesert-mirror.service) is somehow running again
#   cpu       every High Desert unit's mean CPU over the last 15 minutes, from
#             systemd's cgroup accounting sampled each minute by hd-cpu-sample
#             (/root/vps-tools): FAIL above 10% of a core. The mirror once sat at
#             47% for days, seeding to nobody, and no line said so
#   live      highdesert-live (the phone lines) active and answering /live-api/health;
#             connected callers, messages in the last hour, and its 15-minute
#             CPU (hd-cpu-sample) against the 10% rule — FAIL above 10% of a core
#   warm      the nightly warm job's last run (warm-status.json): WARN if it is
#             older than 36h, skipped for steal, or fetched with failures
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
#   HD_PRESENCE_CMD, HD_SITE (https://highdesert.space), HD_SAR_CMD (sar -u),
#   HD_MIRROR_MANIFEST_URL ($HD_SITE/mirror/manifest), HD_MIRROR_PINS, HD_MIRROR_PROXY_CACHE,
#   HD_WARM_STATUS, HD_WARM_MAX_AGE_S (129600), HD_CPU_CMD (hd-cpu-sample report --window 900),
#   HD_LIVE (http://127.0.0.1:3005)
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
SAR_CMD="${HD_SAR_CMD:-sar -u}"
MIRROR_MANIFEST_URL="${HD_MIRROR_MANIFEST_URL:-$SITE/mirror/manifest}"
MIRROR_PINS="${HD_MIRROR_PINS:-/var/lib/highdesert-mirror/pins}"
MIRROR_PROXY_CACHE="${HD_MIRROR_PROXY_CACHE:-/var/cache/highdesert-mirror/proxy}"
CPU_CMD="${HD_CPU_CMD:-hd-cpu-sample report --window 900}"
CPU_MAX_PCT=10
WARM_STATUS="${HD_WARM_STATUS:-/var/cache/highdesert-mirror/warm-status.json}"
WARM_MAX_AGE_S="${HD_WARM_MAX_AGE_S:-129600}"
LIVE="${HD_LIVE:-http://127.0.0.1:3005}"
# Same default as the `cpu` line's HD_CPU_CMD; its own name so the two lines merge cleanly.
LIVE_CPU_CMD="${HD_CPU_CMD:-hd-cpu-sample report --window 900}"

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

# --- steal -------------------------------------------------------------------
# The same source and arithmetic as vps-cpu-alert and the warm job's own gate
# (services/mirror/lib/steal.mjs): the last three 10-minute samples.
steal="$(LC_ALL=C $SAR_CMD 2>/dev/null | awk '$2 == "all" && $1 ~ /^[0-9][0-9]:[0-9][0-9]/ && NF >= 8 { v[n++] = $7 }
  END { if (n == 0) exit; k = n < 3 ? n : 3; for (i = n - k; i < n; i++) t += v[i]; printf "%.1f", t / k }')"
if [[ -z "$steal" ]]; then
  line WARN steal "no sysstat samples today — cannot measure hypervisor steal"
elif awk -v x="$steal" 'BEGIN { exit !(x > 50) }'; then
  line FAIL steal "${steal}% hypervisor steal over 30 min (FAIL above 50%)"
elif awk -v x="$steal" 'BEGIN { exit !(x > 20) }'; then
  line WARN steal "${steal}% hypervisor steal over 30 min (WARN above 20%; the warm job skips itself)"
else
  line OK steal "${steal}% hypervisor steal over 30 min"
fi

# --- mirror ------------------------------------------------------------------
# The archive.org outage fallback: nginx serves the pins and fills the rest
# (services/mirror/lib/nginx.mjs). No manifest, or an empty one, is a FAIL:
# then nothing catches a listener when archive.org stops answering.
gb() { awk -v b="${1:-0}" 'BEGIN { printf "%.1f GB", b / 1073741824 }'; }
dir_bytes() { du -sb "$1" 2>/dev/null | cut -f1; }
manifest="$(curl -s --max-time 10 "$MIRROR_MANIFEST_URL" 2>/dev/null)"
m_count="$(jq -r 'if (.fileHashes | type) == "array" then .fileHashes | length else empty end' <<<"$manifest" 2>/dev/null)"
if [[ -z "$m_count" ]]; then
  line FAIL mirror "$MIRROR_MANIFEST_URL did not answer with a manifest — no fallback if archive.org goes down"
elif (( m_count == 0 )); then
  line FAIL mirror "the manifest lists no pinned episodes — nothing would play if archive.org went down"
else
  mplays="$(curl -s --max-time 10 "$API/api/stats/traffic?range=24h" 2>/dev/null | jq -r '.playsBySource.mirror // 0' 2>/dev/null)"
  pins_b="$(dir_bytes "$MIRROR_PINS")"
  fill_b="$(dir_bytes "$MIRROR_PROXY_CACHE")"
  desc="nginx: $m_count pinned ($(gb "${pins_b:-0}")), fill cache $([[ -n "$fill_b" ]] && gb "$fill_b" || echo '?'),"
  desc="$desc manifest $(jq -r '.version // "?"' <<<"$manifest"), ${mplays:-?} mirror play(s) in 24h"
  if [[ "$("$SYSTEMCTL" is-active highdesert-mirror 2>/dev/null)" == active ]]; then
    line WARN mirror "highdesert-mirror (the retired webtorrent gateway) is running again; $desc"
  else
    line OK mirror "$desc"
  fi
fi

# --- cpu ---------------------------------------------------------------------
# hd-cpu-sample prints "<unit> <percent of one core>" per unit, averaged over
# the window from its once-a-minute cgroup samples; exit 3 means it does not
# yet hold a full window. A status run cannot watch 15 minutes itself.
cpu_out="$($CPU_CMD 2>&1)"
cpu_rc=$?
if (( cpu_rc != 0 )); then
  line WARN cpu "no 15-minute CPU figure (exit $cpu_rc): $(tail -1 <<<"$cpu_out")"
else
  over="$(awk -v t="$CPU_MAX_PCT" 'NF >= 2 && $2 + 0 > t { printf "%s%s %.1f%%", sep, $1, $2; sep = ", " }' <<<"$cpu_out")"
  top="$(awk 'NF >= 2 && ($2 + 0 > m || n == 0) { m = $2 + 0; u = $1; n = 1 } END { if (n) printf "%s %.1f%%", u, m }' <<<"$cpu_out")"
  if [[ -n "$over" ]]; then
    line FAIL cpu "over ${CPU_MAX_PCT}% of a core, 15-min mean: $over"
  elif [[ -z "$top" ]]; then
    line WARN cpu "hd-cpu-sample reported no units"
  else
    line OK cpu "every High Desert unit under ${CPU_MAX_PCT}% of a core over 15 min (highest: $top)"
  fi
fi

# --- live (BEGIN highdesert-live) ------------------------------------------
# The phone lines (services/live). Down is a FAIL. So is breaking the 10% rule:
# no High Desert background service may sustain more than 10% of one core over
# 15 minutes. The figure is hd-cpu-sample's (vps-tools: a timer samples each
# unit's cgroup usage_usec every minute into a ring; `report` averages it), the
# same source as the `cpu` line. Until the ring spans the window (a fresh
# install, the timer stopped) or while it has no row for the unit (started
# inside the window), the service's own 15-minute process.cpuUsage average from
# /live-api/health is judged instead, and the line says which it used.
live_status() {
  if [[ "$("$SYSTEMCTL" is-active highdesert-live 2>/dev/null)" != active ]]; then
    line FAIL live "highdesert-live is not active — the phone lines are down"
    return
  fi
  local health
  health="$(curl -s --max-time 5 "$LIVE/live-api/health" 2>/dev/null)"
  if [[ "$(jq -r '.ok // empty' <<<"$health" 2>/dev/null)" != true ]]; then
    line FAIL live "active, but $LIVE/live-api/health did not answer"
    return
  fi
  local clients msgs slow report rc pct src desc
  clients="$(jq -r '.clients // 0' <<<"$health")"
  msgs="$(jq -r '.messagesLastHour // 0' <<<"$health")"
  slow="$(jq -r '.slowMode // false' <<<"$health")"
  report="$($LIVE_CPU_CMD 2>/dev/null)"
  rc=$?
  pct=""
  if (( rc == 0 )); then
    pct="$(awk '$1 == "highdesert-live" { print $2; exit }' <<<"$report")"
    src="hd-cpu-sample"
  fi
  if [[ -z "$pct" ]]; then
    pct="$(jq -r '.cpu.pct // empty' <<<"$health")"
    src="the service's own average; hd-cpu-sample has no 15-min figure for it yet"
  fi
  desc="$clients caller(s) connected, $msgs message(s) in the last hour"
  [[ "$slow" == true ]] && desc="$desc, slow mode on"
  if [[ -z "$pct" ]]; then
    line WARN live "$desc; CPU not measurable yet (no hd-cpu-sample figure, service under a minute old)"
  elif awk -v x="$pct" 'BEGIN { exit !(x > 10) }'; then
    line FAIL live "OVER THE 10% RULE: CPU ${pct}% of one core over 15 min ($src); $desc"
  else
    line OK live "$desc; CPU ${pct}% of one core over 15 min ($src), limit 10%"
  fi
}
live_status
# --- live (END highdesert-live) --------------------------------------------

# --- warm --------------------------------------------------------------------
if [[ ! -f "$WARM_STATUS" ]]; then
  line WARN warm "no $WARM_STATUS — the warm job has never run"
else
  w_at="$(jq -r '.at // empty' "$WARM_STATUS" 2>/dev/null)"
  w_out="$(jq -r '.outcome // empty' "$WARM_STATUS" 2>/dev/null)"
  w() { jq -r ".$1 // 0" "$WARM_STATUS" 2>/dev/null; }
  w_failed="$(w failed)"
  w_desc="$(w pinned) pinned ($(gb "$(w bytes)")), $(w fetched) fetched, $w_failed failed"
  w_age=$(( $(date +%s) - $(date -d "$w_at" +%s 2>/dev/null || echo 0) ))
  if [[ -z "$w_at" ]]; then
    line WARN warm "$WARM_STATUS is unreadable"
  elif (( w_age > WARM_MAX_AGE_S )); then
    line WARN warm "STALE: last run $w_at ($(( w_age / 3600 ))h ago; runs nightly)"
  elif [[ "$w_out" == skipped-steal ]]; then
    line WARN warm "last run $w_at skipped itself: steal $(w steal)% over 20%"
  elif (( w_failed > 0 )); then
    line WARN warm "last run $w_at ($w_out): $w_desc"
  else
    line OK warm "last run $w_at ($w_out): $w_desc"
  fi
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
