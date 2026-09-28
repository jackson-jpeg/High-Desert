# The weekly digest

Every Monday at 17:40 UTC, `highdesert-digest.timer` runs `scripts/digest.mjs`,
which writes `docs/digest/YYYY-MM-DD.md` (that Monday) to `main` from its own
checkout and copies it to the Mac's `~/Downloads/high-desert-digest/`. The
first is 2026-10-05.

It is one screen, in this order:

1. **Needs you.** Every `FAIL` from `highdesert-status` with what to do about
   it, the release line if it is over 3% on 300 or more plays, and any source
   the job could not read. "Nothing this week." when there is nothing.
2. **Release.** The failed-start rate on this release's builds, with its
   sample, and a verdict once there are 300 plays; older builds apart
   (`docs/reliability-baseline.md`).
3. **Funnel.** Progress toward the before-and-after verdict, or the verdict
   (`docs/funnel.md`).
4. **Locked phones.** The week's `handover-rejected` rows: how many were on a
   hidden page (a locked or backgrounded phone), how many came after a tab
   updated itself, and by device.
5. **The week.** Peaks and plays, the top five shows, and where callers said
   they were calling from.
6. **Health.** Every non-OK status line, then disk, pins and CPU.

**Evidence, when it matters.** If a check FAILs, or the release is at 3% or
more on 300 or more plays, the digest adds a section below the screen: the rows
(the release's own when the release is the problem), the pattern (by kind,
device, source, page visibility, show and hour), and a proposed fix. The fix
is a first guess from the pattern, written for a fix session to start from,
not a diagnosis.

**Rules the job keeps.**
- A written week is frozen: later runs never rewrite it.
- A Monday the box missed is written on the next run (Tuesday), for that Monday.
- A copy the sleeping Mac missed is retried every day.
- A source that cannot be read is named at the top, never shown as "none".
- No em dashes, including in show titles that carry one.
- The unit runs at `CPUQuota=10%`, `Nice=19`, idle IO (a run takes about a minute).

**Where it stands:** `/var/lib/highdesert-digest/status.json`, and the `digest`
line in `highdesert-status`. `node scripts/digest.mjs --preview <file>`
renders the week now without writing anything else.

Install (once, as root):

```bash
cp deploy/highdesert-digest.service deploy/highdesert-digest.timer /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now highdesert-digest.timer
```
