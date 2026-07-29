#!/usr/bin/env bash
#
# Deploy High Desert on the VPS.
#
# /root/High-Desert IS the production directory — `next start` reads chunks from
# .next lazily, at request time, so the running server holds a manifest pointing
# at files on disk. Two failure modes follow from that, and this script exists
# to make both hard to hit:
#
#   1. Building in place replaces the content-hashed chunks the running process
#      still refers to. Every route keeps returning 200 while the browser cannot
#      load the app. A status check will not catch it; only the restart fixes it,
#      so build and restart must never be separated by a human deciding to go to
#      bed. They are one step here.
#
#   2. A build taken from an uncommitted tree used to inherit HEAD's short SHA
#      as NEXT_PUBLIC_BUILD_ID, which names the service worker cache. Repeating
#      the previous deploy's id means `activate` does not purge the previous
#      deploy's shell. next.config.ts now hashes the working tree so the id is
#      always distinct, but a dirty deploy is still a deploy of something that
#      is not in git, and that is worth refusing outright.
#
# Usage:
#   bash scripts/deploy.sh            # refuse to deploy a dirty tree
#   bash scripts/deploy.sh --allow-dirty
#
set -euo pipefail

cd "$(dirname "$0")/.."

ALLOW_DIRTY=0
[[ "${1:-}" == "--allow-dirty" ]] && ALLOW_DIRTY=1

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mdeploy: %s\033[0m\n' "$*" >&2; exit 1; }

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

if [[ package-lock.json -nt node_modules ]]; then
  say "package-lock.json is newer than node_modules — running npm ci"
  npm ci
fi

say "Building"
npm run build

say "Restarting highdesert.service"
systemctl restart highdesert

# next start needs a moment before it will answer.
for _ in $(seq 1 30); do
  curl -sf -o /dev/null http://127.0.0.1:3003/ && break
  sleep 1
done

say "Verifying the client, not just the status code"
FAILED=0
for page in / /library /radio /stats; do
  html="$(curl -s "http://127.0.0.1:3003$page")"
  total=0
  bad=0
  for chunk in $(grep -oE '/_next/static/chunks/[a-zA-Z0-9._-]+\.js' <<<"$html" | sort -u); do
    total=$((total + 1))
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3003$chunk")"
    if [[ "$code" != "200" ]]; then
      echo "  $code $chunk"
      bad=$((bad + 1))
    fi
  done
  printf '  %-10s chunks=%-3s non-200=%s\n' "$page" "$total" "$bad"
  FAILED=$((FAILED + bad))
done

if (( FAILED )); then
  die "$FAILED chunk(s) did not return 200. The deploy is live but broken —
     the running server is serving a manifest that does not match .next.
     Re-run the build and restart before walking away."
fi

# sw.js reads its own ?v= at runtime, so the id lives in the client bundle that
# registers it — not in the worker source, and not as a literal in the HTML
# either: the registration is `sw.js?v=${encodeURIComponent(BUILD_ID)}`, so the
# assembled string never appears statically anywhere. Find the chunk doing the
# registering and confirm the deployed commit is baked into it.
#
# This is the check that would have caught the deploy stamped with its
# predecessor's commit.
say "Build id baked into the service-worker registration"
REG_CHUNK="$(grep -rl 'sw\.js?v=' .next/static/chunks/*.js 2>/dev/null | head -1)"
if [[ -z "$REG_CHUNK" ]]; then
  die "Could not find the chunk that registers the service worker.
     If the registration moved, update this check — do not delete it."
fi
if grep -q "$BUILD_REF" "$REG_CHUNK"; then
  echo "  $BUILD_REF found in $(basename "$REG_CHUNK")"
else
  die "The deployed commit '$BUILD_REF' is not in the registration chunk.
     The build did not come from this tree — this is the cache-name collision
     that ships a deploy stamped with its predecessor. Rebuild and restart."
fi

say "Deployed $BUILD_REF cleanly"
