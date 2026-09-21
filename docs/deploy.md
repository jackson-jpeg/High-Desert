# Deploying High Desert

`scripts/deploy.sh` is the only supported way to put a build live. It exists
because `/root/High-Desert` **is** the production directory: `next start` reads
chunks from `.next` lazily, so anything that deletes or rewrites `.next` or
`node_modules` under the running process breaks every browser while every route
keeps returning 200.

```bash
cd /root/High-Desert
git pull                               # or check out the intended ref
bash scripts/deploy.sh                 # refuses a dirty tree
bash scripts/deploy.sh --verify-only   # check the running server; changes nothing
bash scripts/deploy.sh --rollback      # swap current <-> previous build, restart, verify
```

## What it does

1. Refuses a dirty tree (`--allow-dirty` overrides). A build that is not in git
   is not reproducible, and `NEXT_PUBLIC_BUILD_ID` names the service-worker
   cache.
2. **Builds into `.next-staging`**, not `.next`. `next.config.ts` reads the
   distDir from `HD_DIST_DIR`. `next build` empties its distDir before
   compiling, which is why building in place was an outage waiting for a failed
   build.
3. **If `package-lock.json` changed** (its sha256 differs from
   `node_modules/.hd-lock-sha256`), it copies the tree to
   `/root/.hd-deploy-stage/High-Desert`, runs `npm ci` and the build there, and
   moves the new `node_modules` and the build across only after both succeed.
   The live `node_modules` is never deleted under the running server. The copy
   keeps the `High-Desert` basename and depth, so Turbopack's relative symlinks
   for server externals still resolve after the move. Next 16.3 writes
   `.next/node_modules/pg-… -> ../../node_modules/pg`; 16.2 wrote
   `../../../High-Desert/node_modules/pg`.
4. Confirms that the commit is baked into the chunk that registers the service
   worker, **before** anything is swapped.
5. Renames `.next` to `.next.prev` and `.next-staging` to `.next` (and does the
   same for `node_modules` if it was re-installed), then restarts `highdesert`.
6. **Verifies from the client's side.** It waits for the port, then fetches `/`,
   `/library`, `/radio` and `/stats`. Each page must return 200 and reference at
   least one `/_next/static/chunks/*.js`, and every referenced chunk must return
   200. A server that never answers fails. So does a page with no chunks. Both
   used to pass as "0 broken chunks".
7. **If verification fails, it rolls back automatically.** It swaps `.next.prev`
   back into place, restarts, verifies again, and exits non-zero either way.

`--rollback` swaps the live and previous builds, so running it twice undoes it.
There is exactly one level of history.

A flock on `.deploy/lock` prevents two deploys from running at once.
`.deploy/deployed` records the last deployed commit and its time.

## Tests

`scripts/__tests__/deploy.test.ts` runs the real script against a throwaway git
repo, a stub `systemctl` and a fake HTTP server. The server serves whichever
build is renamed into `.next`, the same way `next start` does. Four mutations in
`scripts/mutate-check.mjs` prove the suite observes:

- `deploy-staging-dist`: building into the live `.next`
- `deploy-zero-chunks`: the check for a page with no chunks
- `deploy-never-up`: the check for a server that never answered
- `deploy-auto-rollback`: the rollback when verification fails

## Failure-path rehearsals, 2026-09-21

These were run against the **live** service, as the mandate for HD-005 required.

### 1. Failed build, dependencies unchanged (in-place path)

Branch `throwaway/deploy-proof` (commit `cf39485`, since deleted) added
`export const deployProofTypeError: number = "not a number";` to
`src/lib/utils/cn.ts`.

```
13:49:32Z  bash scripts/deploy.sh
==> Building into .next-staging (the live .next is not touched)
./src/lib/utils/cn.ts:8:14
Type error: Type 'string' is not assignable to type 'number'.
deploy: Build failed. The live site is untouched.
deploy exit=1                                     13:50:01Z
```

- `.next/BUILD_ID` was `WCsx0APkXiv_O2vHyulvh` before and after the run.
- Neither `.next-staging` nor `.next.prev` was left behind.
- `highdesert` was not restarted: `ActiveEnterTimestamp` stayed at
  `2026-09-11 06:37:37 UTC`.
- `--verify-only` passed immediately afterwards: `/` had 14 chunks, `/library`,
  `/radio` and `/stats` had 20 each, and none returned non-200. Public
  `https://highdesert.space/library` returned 200.

### 1b. Failed build, lockfile changed (staging-copy path)

This used the same branch with the lockfile stamp removed, to force the
dependency path.

```
13:50:11Z  bash scripts/deploy.sh
==> package-lock.json changed — installing and building in /root/.hd-deploy-stage/High-Desert
added 480 packages in 16s
Type error: Type 'string' is not assignable to type 'number'.
deploy: Build failed in the staging copy. The live site is untouched.
deploy exit=1                                     13:50:59Z
```

- The live `node_modules` directory kept the same inode (`4752448`), so it was
  never replaced.
- `.next/BUILD_ID` was unchanged, and `--verify-only` passed.
- The staging copy was left on disk after this run. The script now deletes it
  on failure.

### 2. Service stopped, then `--verify-only`

```
13:51:20Z  systemctl stop highdesert
           HD_WAIT_SECS=5 bash scripts/deploy.sh --verify-only
  server on :3003 never answered within 5s
deploy: verification failed
verify-only exit=1
           systemctl start highdesert
           bash scripts/deploy.sh --verify-only   -> Verified (all four pages 200)
13:51:29Z
```

The planned downtime lasted about 9 seconds.

The success path, including the dependency swap, was then exercised by the real
deploy of the Next.js 16.3 upgrade. See the Deploy log below.

## Deploy log

| When (UTC) | Commit | Path | Result |
|---|---|---|---|
| 2026-09-21 14:00:49 → 14:01:57 | `43a0d89` (Next 16.3.5, music-metadata 11, CSP) | lockfile changed → staging copy, `npm ci`, node_modules swapped | ✅ verified: / 13 chunks, /library /radio /stats 19 each, all 200 |
