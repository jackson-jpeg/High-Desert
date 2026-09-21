# Security exceptions

Advisories that `npm audit` reports and that are knowingly left open, each with
a reason and a condition for revisiting it. `highdesert-status` FAILs on any
critical or high advisory in production dependencies (`--omit=dev`). An
advisory may be recorded here only if it is dev-only or demonstrably
unreachable, and recording it does **not** silence that check.

## Production dependencies (`npm audit --omit=dev`)

**None.** As of 2026-09-21 there are 0 critical, 0 high, 0 moderate and 0 low
advisories in production dependencies. The upgrade that got there:

- `next` and `eslint-config-next` 16.2.12 → 16.3.5. This closes
  GHSA-2xp9-vwfh-vxw4 (critical: RCE in the Image Optimization API) and
  GHSA-p293-qw3h-jr36 (critical: RCE on Windows hosts). `images.unoptimized`
  also removes `/_next/image` entirely; it now returns 404.
- `music-metadata-browser` was replaced by `music-metadata` 11.15. The wrapper is
  unmaintained and pinned a `music-metadata`/`file-type` with an ASF-parser
  infinite loop, and its only suggested "fix" was a downgrade.
- `npm audit fix` updated `postcss`, `sharp` and `nanoid`.

## Development-only

| Advisory | Package | Severity | Why it stays open |
|---|---|---|---|
| Path traversal / arbitrary file read via the `@vitest/mocker` redirect mock | `vitest` 3.2.7 → `@vitest/mocker` 3.2.7 | moderate | Test runner only; it never ships or runs in production. The fix is `vitest` 5, a major upgrade that needs its own pass over the test suite and `scripts/mutate-check.mjs`. Dependabot (weekly) will propose it. Revisit when that PR lands. |
