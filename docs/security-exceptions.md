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

**None.** `npm audit` (all dependencies) reports 0 advisories as of 2026-09-21.
The `@vitest/mocker` path-traversal advisory (moderate) was closed by upgrading
`vitest` 3.2.7 → 5.0.1; `jsdom` went 26 → 30 in the same pass (Dependabot #11).
The whole suite and every mutation stayed green.

## Dependabot majors declined

Majors that could not be upgraded with the suite and every mutation green are
closed with a one-line reason here, so the decision is findable.

- **eslint 9 → 10** (PR #14, 2026-09-21): `npm run lint` crashes — the `eslint-plugin-react` bundled by `eslint-config-next` 16.3.5 calls `context.getFilename()`, removed in ESLint 10, and it and `eslint-plugin-import`/`jsx-a11y` declare peer ranges ending at `^9`. Retry when `eslint-config-next` supports 10. Dev-only; no advisory against eslint 9.
