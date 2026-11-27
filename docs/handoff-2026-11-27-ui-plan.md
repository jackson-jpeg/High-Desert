# Handoff 2026-11-27: the UI plan live, and the mutation run made cheap

Session `high-desert-3d`. Times UTC.

## Live

`4bc82eb` deployed 09:2x by `scripts/deploy.sh` (client verify on every
route; returning visitor ok in Chromium and WebKit, d1d14a4 to 4bc82eb).
check:csp and check:seo against production: clean. Station notices posted
before (09:15) and after.

What it carries: UI plan pushes 1, 1b, 2, 3, 4, 5 (`docs/UI-PLAN.md`; the
before and after at 390 for each are in the Mac's
`~/Downloads/highdesert-ui-plan/push-N/`), plus:

- `df146a8`: no era dial in the Library's station card. At 1280 x 720 its
  height pushed the list's first row off the screen (e2e `looks.spec`
  "library, its detail panel"). Live keeps it. Test in `radio-set.test.tsx`,
  mutation `uiplan-library-no-dial`.
- `efc8bf0`: `uiplan-1b-lamp` had lost its closing brace in the replay and
  merged into the next entry. `mutation-list.test.ts` would have caught it;
  it was not run on the stack before. Split again, red.
- `805d178`: `presence-traffic-fork`, `uiplan-desert-blink-slow`,
  `uiplan-dial-in-live` re-anchored (push 5, 1b, the Library card). Red.
- `876130f`: `e2e/request-line.spec.ts` measures the phone's hero, note and
  Call in in one frame. Two awaits apart it read a 60 px gap when the show's
  hook arrived between them (6 of 6 pass on repeat).
- Merge `4bc82eb`: main's mutation redesign and the stack both appended to
  `mutate-check.mjs`; resolved as the union, 1,431 entries, each anchor
  found once.

Checks on the merged tree: lint, typecheck, full vitest (3,287 + 266 with
the chat's dependencies linked). E2e on a local stack with the chat behind
one origin (`scripts/live-e2e-stack.mjs`, e2e database): looks, library-phone,
live-phone, station-welcome, request-line, live-qa: all pass but one.

## Open

- **The phone Night offer does not show** (`looks.spec` "win98: the
  first-visit Night offer", mobile). It fails on production's previous build
  too, so it predates this work. In NEXT's Queue.

## The mutation run (the lead for Jackson)

`909caf4`, `c107d19`, `4de482a` on main; fyi filed (Journal id
`75c50772`). Nightly at 20:30 UTC, incremental since the last green head plus
every test whose import closure reaches a changed file plus the last
survivors; full every 30 days; CPUQuota=150%, Nice=19, idle IO, heavy's low
lane, vitest `--maxWorkers=2`. Status and the digest read the newest run only.

Transition: the old full run (normal lane) was stopped at 229 checked. The new
timer fired at once on install (Persistent caught the 20:30 slot it had
"missed") and chose full, because `full.json` did not exist yet: stopped,
`full.json` seeded from the 11-18 full run (1,299 of 1,305 red), and the
first incremental selected all 1,365 because a repo-URL edit in package.json
forced a run of all: fixed in `4de482a` (only dependency, script and similar
fields count). Incremental run of 444 started 07:31 on `4de482a`. Sanger's
typecheck and tests for High Desert pass on `4de482a`. CPU: load 14 to 19
before, about 6 after; the unit 3.5% of a core.

## Hook blocks hit

- The pipefail hook rewrote many commands (`set -o pipefail;` added); twice
  that left the auto-mode classifier without a verdict on a parallel call. I
  reissued each on its own.
- Earlier in the session: an ssh pipe to the Mac and a foreground `sleep`
  were blocked; done another way (scp, background waits).

## Cleaned up

Test servers (:3071, :3072), the chat test service (:3075), the one-origin
proxy (:3074), worktrees `hd-p1`..`hd-p5`, `hd-p1b`, `hd-p1b-build`,
`hd-p1-build`, `hd-ui-w`, `hd-lane`, `hd-mut`, `hd-mut2`, `hd-merge`; the
merged branches deleted. The pre-replay branches `ui-push1`, `ui-p1` to `ui-p5`
and `ui-p1b` are kept as refs (their code is in main through the replayed
stack). `/root/scratch/hd-ui` removed.

## Later, 10:10 to 11:40 (the lead: Night offer, then push 2)

- **The phone Night offer** was Jackson's phone look split (until
  2026-12-02) doing its job, not a bug: a brand-new phone gets a look and
  its offer record "split". The spec now covers both sides (`a1f4004`).
- **Push 2** was already live; read back on production at 390 and 1280 in
  both looks. Its one unbuilt part, Win98 Notepad's line lamp, is live as
  `cb5c734` and `cb637f8` (lamp and label wrap together). Production had no
  listener calls at read-back; shots are from the same build with local calls.
- **Hook block:** `npm ci` in my worktree was refused while its
  `node_modules` was a symlink to production's (it would have rewritten the
  live packages through the link). Removed the link on its own, checked it,
  then installed. Turbopack had refused the symlink anyway.
- Fyis: `b24fba7c` (Night offer), `7e74c6d4` (the lamp). Cleaned: servers
  :3072, :3074, :3075, worktree and branches, `/root/scratch/hd-night`.
