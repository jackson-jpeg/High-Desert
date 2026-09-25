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

## HD-043 — the admin password hash ships in the client bundle

Accepted, knowingly. `ADMIN_HASH` in `src/stores/admin-store.ts` is an unsalted
SHA-256, a public constant in every visitor's JavaScript, so it can be attacked
offline at GPU speed. That is acceptable **only** because admin mode is a UI gate,
not a security boundary (CLAUDE.md, "Admin Mode"): anyone can set
`localStorage['hd-admin']` directly, and every admin feature is local-only and
touches nothing server-side. Nothing that must actually be protected may ever sit
behind it. No attempt was made to recover the plaintext.

The real exposure would be the *password* being reused somewhere that is a
boundary. Checked on 2026-09-25, without printing or storing any secret:

- **The hash (hex, upper/lower case), its base64 and base64url forms**, grepped
  across `/root` and `/etc` (excluding `node_modules`, `.next*`, `.git`, and the
  High Desert repo and its worktrees). Hits: only other High Desert worktrees
  (`/root/hd-*/src/stores/admin-store.ts` and its test) and Claude session
  transcripts that contain this repo's file. No other project, config or unit.
- **Compressed archives** — the 90 `*.gz`/`*.tgz`/`*.zip`/`*.dump` files under
  `/root` and `/etc` under 2 GB, including every tarball in `/root/retired`
  (OpenClaw, Augie, ecfiler, the agent daemons): decompressed and searched for
  the hex and base64 forms. 0 hits.
- **Every value in the chmod-600 env files** — `/root/.*.env` (12 files) and
  `/etc/sogojet/env*` (13, including the dated backups): 237 values, each hashed
  with SHA-256 as written, trimmed, unquoted, and split on whitespace/commas, and
  compared with `ADMIN_HASH`. 0 matches. So the admin password is not any
  service's secret, token or password on this box.

Revisit if admin mode ever gains a server-side effect — then it needs a real
server-checked credential, not a better hash.
