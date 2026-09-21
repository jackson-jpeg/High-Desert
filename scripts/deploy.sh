#!/usr/bin/env bash
#
# Deploy High Desert on the VPS.
#
# /root/High-Desert IS the production directory — `next start` reads chunks from
# .next lazily, at request time, so the running server holds a manifest pointing
# at files on disk. Everything below follows from that:
#
#   1. The live `.next` is never written by a build. `next build` empties its
#      distDir before compiling, so building in place meant a failed build (a
#      type error, an OOM) exited before the restart and left the live process
#      serving a manifest for chunks that had just been deleted — every route
#      200, no working client. Builds go to `.next-staging` (HD_DIST_DIR, read by
#      next.config.ts) and are renamed into place only once they succeed.
#
#   2. `node_modules` is never deleted under the live process. When the lockfile
#      changed, dependencies are installed and the build is run in a staging copy
#      of the tree; the new `node_modules` is swapped in with the new build.
#
#   3. A deploy is not done until the running server has been checked from the
#      client's side: every page 200, every page referencing at least one chunk,
#      every chunk 200. A server that never answered, or a page with no chunks,
#      is a failure — it used to count as zero broken chunks and print success.
#      Any failure rolls back to the previous build automatically.
#
#   4. A build taken from an uncommitted tree is refused (see --allow-dirty):
#      NEXT_PUBLIC_BUILD_ID names the service-worker cache, and a build that is
#      not in git is not reproducible.
#
# Usage:
#   bash scripts/deploy.sh                 # deploy HEAD; refuses a dirty tree
#   bash scripts/deploy.sh --allow-dirty   # deploy the working tree anyway
#   bash scripts/deploy.sh --verify-only   # check the running server; no changes
#   bash scripts/deploy.sh --rollback      # swap current and previous build, restart, verify
#
# Records of the failure-path rehearsals are in docs/deploy.md.
#
# Overridable for scripts/__tests__/deploy.test.ts, which drives this script
# against a fake server and a stub systemctl. Production uses the defaults.
#   HD_ROOT       project directory             (default: this script's repo)
#   HD_PORT       port the service listens on   (default: 3003)
#   HD_SERVICE    systemd unit                  (default: highdesert)
#   HD_SYSTEMCTL  systemctl binary              (default: systemctl)
#   HD_BUILD_CMD  build command                 (default: npm run build)
#   HD_WAIT_SECS  how long to wait for the port (default: 60)
#   HD_STAGE_DIR  parent of the dependency staging copy (default: /root/.hd-deploy-stage)
#
set -euo pipefail

ROOT="${HD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PORT="${HD_PORT:-3003}"
SERVICE="${HD_SERVICE:-highdesert}"
SYSTEMCTL="${HD_SYSTEMCTL:-systemctl}"
BUILD_CMD="${HD_BUILD_CMD:-npm run build}"
WAIT_SECS="${HD_WAIT_SECS:-60}"
STAGE_PARENT="${HD_STAGE_DIR:-/root/.hd-deploy-stage}"
PAGES=(/ /library /radio /stats)
BASE="http://127.0.0.1:$PORT"

LIVE=".next"
STAGING=".next-staging"
PREV=".next.prev"
STATE_DIR=".deploy"
LOCK_STAMP="node_modules/.hd-lock-sha256"

cd "$ROOT"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*" >&2; }
die() { printf '\n\033[1;31mdeploy: %s\033[0m\n' "$*" >&2; exit 1; }

MODE=deploy
ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    --verify-only) MODE=verify ;;
    --rollback) MODE=rollback ;;
    *) die "unknown argument: $arg" ;;
  esac
done

mkdir -p "$STATE_DIR"
# One deploy at a time. Two concurrent deploys renaming the same directories
# is not a state anyone should have to reason about.
exec 9>"$STATE_DIR/lock"
flock -n 9 || die "another deploy is running (lock: $STATE_DIR/lock)"

# ---------------------------------------------------------------------------
# verify — the client's view of the running server. Returns non-zero on any
# failure; prints one line per page.
# ---------------------------------------------------------------------------
verify() {
  local up=0
  for _ in $(seq 1 "$WAIT_SECS"); do
    if curl -s -o /dev/null --max-time 5 "$BASE/"; then up=1; break; fi
    sleep 1
  done
  if (( ! up )); then
    echo "  server on :$PORT never answered within ${WAIT_SECS}s"
    return 1
  fi

  local failed=0 page status html total bad chunk code
  for page in "${PAGES[@]}"; do
    status="$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$BASE$page" || true)"
    html="$(curl -s --max-time 20 "$BASE$page" || true)"
    total=0
    bad=0
    for chunk in $(grep -oE '/_next/static/chunks/[a-zA-Z0-9._-]+\.js' <<<"$html" | sort -u); do
      total=$((total + 1))
      code="$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' "$BASE$chunk" || true)"
      if [[ "$code" != "200" ]]; then
        echo "    $code $chunk"
        bad=$((bad + 1))
      fi
    done
    printf '  %-10s status=%s chunks=%-3s non-200=%s\n' "$page" "$status" "$total" "$bad"
    if [[ "$status" != "200" ]]; then
      echo "    page did not return 200"
      failed=$((failed + 1))
    fi
    if (( total == 0 )); then
      echo "    page references no chunks — nothing a browser could run"
      failed=$((failed + 1))
    fi
    failed=$((failed + bad))
  done
  (( failed == 0 ))
}

restart() {
  say "Restarting $SERVICE"
  "$SYSTEMCTL" restart "$SERVICE"
}

# Swap the live build with the previous one — and node_modules too, when the
# deploy being undone replaced them. Used by --rollback and by a failed verify.
swap_back() {
  [[ -d "$PREV" ]] || die "no previous build ($PREV) to roll back to"
  local deps=0
  [[ -f "$STATE_DIR/deps-swapped" && -d node_modules.prev ]] && deps=1

  rm -rf .next.failed
  mv "$LIVE" .next.failed
  mv "$PREV" "$LIVE"
  mv .next.failed "$PREV"
  if (( deps )); then
    rm -rf node_modules.failed
    mv node_modules node_modules.failed
    mv node_modules.prev node_modules
    mv node_modules.failed node_modules.prev
  fi
  echo "  $LIVE <-> $PREV swapped$( (( deps )) && echo ', node_modules <-> node_modules.prev swapped')"
}

if [[ "$MODE" == verify ]]; then
  say "Verifying the running server on :$PORT"
  verify || die "verification failed"
  say "Verified"
  exit 0
fi

if [[ "$MODE" == rollback ]]; then
  say "Rolling back to the previous build"
  swap_back
  restart
  say "Verifying"
  verify || die "the rolled-back build failed verification too — the site needs a human"
  say "Rolled back and verified. Run --rollback again to undo."
  exit 0
fi

# ---------------------------------------------------------------------------
# deploy
# ---------------------------------------------------------------------------
say "Checking the working tree"
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  if (( ALLOW_DIRTY )); then
    echo "--allow-dirty: continuing. The build id will be a working-tree hash."
  else
    die "Uncommitted changes. Commit first, then build — a build stamped with a
     commit it does not contain is how the last cache-name collision happened.
     Re-run with --allow-dirty to deploy anyway."
  fi
fi

BUILD_REF="$(git rev-parse --short HEAD)"
say "Deploying $BUILD_REF — $(git log -1 --pretty=%s)"

LOCK_SHA="$(sha256sum package-lock.json | cut -d' ' -f1)"
DEPS_CHANGED=0
if [[ "$(cat "$LOCK_STAMP" 2>/dev/null || true)" != "$LOCK_SHA" ]]; then
  DEPS_CHANGED=1
fi

rm -rf "$STAGING" node_modules.staging

if (( DEPS_CHANGED )); then
  # The staging copy keeps the project's basename and depth, so the relative
  # symlinks Turbopack writes into .next/node_modules (../../node_modules/<pkg>
  # on Next 16.3; 16.2 wrote ../../../<basename>/node_modules/<pkg>) resolve to
  # the live tree after the build is moved across.
  STAGE="$STAGE_PARENT/$(basename "$ROOT")"
  say "package-lock.json changed — installing and building in $STAGE"
  rm -rf "$STAGE"
  mkdir -p "$STAGE"
  rsync -a --exclude=/node_modules --exclude='/node_modules.*' --exclude='/.next*' \
    --exclude="/$STATE_DIR" ./ "$STAGE/"
  if ! (cd "$STAGE" && npm ci --no-audit --no-fund); then
    rm -rf "$STAGE"
    die "npm ci failed in the staging copy. The live site is untouched."
  fi
  if ! (cd "$STAGE" && HD_DIST_DIR="$STAGING" $BUILD_CMD); then
    rm -rf "$STAGE"
    die "Build failed in the staging copy. The live site is untouched."
  fi
  echo "$LOCK_SHA" > "$STAGE/$LOCK_STAMP"
  mv "$STAGE/$STAGING" "$STAGING"
  mv "$STAGE/node_modules" node_modules.staging
  rm -rf "$STAGE"
else
  say "Building into $STAGING (the live $LIVE is not touched)"
  # next build rewrites next-env.d.ts to import from its distDir. Put it back,
  # or `tsc` looks for types in a directory that is about to be renamed away.
  NEXT_ENV_SAVED=""
  [[ -f next-env.d.ts ]] && NEXT_ENV_SAVED="$(cat next-env.d.ts)"
  BUILD_OK=1
  HD_DIST_DIR="$STAGING" $BUILD_CMD || BUILD_OK=0
  [[ -n "$NEXT_ENV_SAVED" ]] && printf '%s\n' "$NEXT_ENV_SAVED" > next-env.d.ts
  if (( ! BUILD_OK )); then
    rm -rf "$STAGING"
    die "Build failed. The live site is untouched."
  fi
fi

# The build id is baked into the client chunk that registers the service
# worker (`sw.js?v=${BUILD_ID}`). Confirm it names this commit before anything
# is swapped — this is the check that would have caught the deploy stamped
# with its predecessor's commit.
say "Build id baked into the service-worker registration"
REG_CHUNK="$(grep -rl 'sw\.js?v=' "$STAGING"/static/chunks/*.js 2>/dev/null | head -1 || true)"
if [[ -z "$REG_CHUNK" ]]; then
  rm -rf "$STAGING" node_modules.staging
  die "Could not find the chunk that registers the service worker. Nothing was
     swapped. If the registration moved, update this check — do not delete it."
fi
if ! grep -q "$BUILD_REF" "$REG_CHUNK"; then
  rm -rf "$STAGING" node_modules.staging
  die "The commit '$BUILD_REF' is not in the registration chunk. Nothing was
     swapped. The build did not come from this tree."
fi
echo "  $BUILD_REF found in $(basename "$REG_CHUNK")"

say "Swapping the new build into place"
rm -rf "$PREV" .next.failed
[[ -d "$LIVE" ]] && mv "$LIVE" "$PREV"
mv "$STAGING" "$LIVE"
rm -f "$STATE_DIR/deps-swapped"
if [[ -d node_modules.staging ]]; then
  rm -rf node_modules.prev
  mv node_modules node_modules.prev
  mv node_modules.staging node_modules
  touch "$STATE_DIR/deps-swapped"
  echo "  node_modules replaced (previous kept as node_modules.prev)"
fi
echo "$BUILD_REF $(date -u +%FT%TZ)" > "$STATE_DIR/deployed"

restart

say "Verifying the client, not just the status code"
if ! verify; then
  warn "Verification failed — rolling back to the previous build"
  if [[ ! -d "$PREV" ]]; then
    die "Verification failed and there is no previous build to return to. The site needs a human."
  fi
  swap_back  # undo the failed deploy
  restart
  if verify; then
    die "Deploy of $BUILD_REF failed verification and was rolled back. The previous build is live and verified."
  fi
  die "Deploy of $BUILD_REF failed verification, and the rolled-back build failed too. The site needs a human."
fi

say "Deployed $BUILD_REF cleanly (previous build kept as $PREV; undo with --rollback)"
