#!/usr/bin/env bash
# Runs a heavy command (next build, vitest, tsc, eslint, npm ci) in its turn:
# through the box-wide `heavy` semaphore (/root/vps-tools/bin/heavy, 2 slots)
# when it is installed, and directly where it is not (CI, a laptop).
#
#   bash scripts/heavy.sh COMMAND [ARGS...]
#
# Why: on 2026-09-28 five builds and test runs from three projects overlapped
# on the VPS and memory fell to 13% (docs/memory-2026-09-28.md). Nested calls
# (npm run build inside deploy.sh's turn) run inside the parent's slot.
#
# HD_HEAVY names the semaphore (default: heavy on PATH); tests point it at a stub.
set -euo pipefail
HEAVY="${HD_HEAVY:-heavy}"
if command -v "$HEAVY" >/dev/null 2>&1; then
  exec "$HEAVY" --label "high-desert $(basename "$1")" -- "$@"
fi
exec "$@"
