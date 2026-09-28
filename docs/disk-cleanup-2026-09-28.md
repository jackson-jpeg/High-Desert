# Disk cleanup, 2026-09-28

Why: the mirror's warm job keeps 10 GiB free on / (the floor, unchanged) and stopped with 318 pins, 14.48 GiB of the 15 GiB target, about 3.2 GB short. Asked for: free the space, don't lower the floor.

| | Free on / |
|---|---|
| Before | 7.45 GB (7,451,328,512 B) |
| After /tmp | 8.30 GB |
| After worktrees | 14.67 GB (14,670,962,688 B) |

Removed in total: **7.24 GB**: 155 /tmp entries (0.835 GB) and 14 git worktrees (6.40 GB).

## Git worktrees

Rule: the worktree's HEAD is an ancestor of the project's default branch after a fetch, `git status --porcelain` is empty (untracked files count as work), it is not locked, and no running process has its cwd or an open file inside it. Removed with `git worktree remove` **without `--force`**, so git itself would refuse any with modified or untracked files. Ignored files in them were only `node_modules` and the generated `next-env.d.ts`, checked one by one. Branches were left in place; only the checkouts are gone, so each is `git worktree add <path> <branch>` away.

| Worktree | Branch | Commit | Size |
|---|---|---|---|
| `/root/hd-hotfix` | `mirror/nginx` | `625a473` | 9.6 MB |
| `/root/hd-int` | `data/integration` | `75e00c3` | 668.6 MB |
| `/root/hd-live` | `fix/live-setup-role` | `300cc3d` | 777.7 MB |
| `/root/hd-live-chat` | `live/chat` | `a685e0f` | 53.6 MB |
| `/root/hd-live-station` | `live/station` | `fa4401b` | 783.4 MB |
| `/root/hd-live-status` | `live-status` | `f93fde0` | 9.4 MB |
| `/root/hd-peaks` | `stats/peaks` | `746fc57` | 778.3 MB |
| `/root/hd-persist` | `data/persist` | `c7af0e5` | 768.3 MB |
| `/root/hd-player-split` | `split/player` | `e73b28d` | 9.6 MB |
| `/root/hd-quality` | `data/quality` | `070a58c` | 774.0 MB |
| `/root/hd-seed` | `data/seed` | `93aa1f6` | 773.0 MB |
| `/root/hd-stats` | `data/stats` | `31df176` | 768.5 MB |
| `/root/hd-sweep` | `sweep/p3` | `4ff3eb2` | 9.6 MB |
| `/root/hd-truth` | `detached` | `detached` | 216.0 MB |

Kept, and why:

| Worktree | Branch | Why kept |
|---|---|---|
| `/root/sogojet-affiliate` | `affiliate-first` | not merged into origin/main, in use by a running process |
| `/root/sogojet-redesign` | `redesign` | not merged into origin/main, in use by a running process |
| `/root/ScreenReceipts-render` | `render-1.2.1` | not merged into origin/master, in use by a running process |
| `/root/LeftSaid-crash` | `crash-hunt` | not merged into origin/master, 5 uncommitted changes |
| `/root/LeftSaid-rebrand` | `feat/rebrand` | not merged into origin/master, 21 uncommitted changes |
| `/root/LeftSaid-site` | `feat/site-rebrand` | not merged into origin/master |
| `/root/hd-live-qa` | `overnight/reliability` | not merged into origin/main, in use by a running process |
| `/root/hd-stats-split` | `split/stats` | not merged into origin/main |
| `/root/bambu-mcp/.claude/worktrees/platecheck-overlap-fix` | `worktree-platecheck-overlap-fix` | not merged into origin/main, locked |

## /tmp

Rule: a top-level entry of /tmp (or a per-session directory under `/tmp/claude-0/<project>/`) whose **newest** file anywhere inside is older than 3 days (before 2026-09-25T06:20Z), which no process holds: not a cwd, open fd, mapped file, command-line or environment path, or listening unix socket of any process, and containing no socket. Mostly Next.js/Turbopack build scratch (the random 21-character names), plus one old ScreenReceipts Claude session scratch (637 MB).

Not removed although old: `/tmp/systemd-private-0a7b3a17a5db4ac69ed1a928ea8b43f8-plotslop.service-1pgpCD` (systemd PrivateTmp of a service); `/tmp/tmux-0` (held by a running process); `/tmp/systemd-private-0a7b3a17a5db4ac69ed1a928ea8b43f8-leftsaid-api.service-nHI14J` (systemd PrivateTmp of a service); `/tmp/systemd-private-0a7b3a17a5db4ac69ed1a928ea8b43f8-systemd-logind.service-h5eWqI` (systemd PrivateTmp of a service); `/tmp/systemd-private-0a7b3a17a5db4ac69ed1a928ea8b43f8-systemd-timesyncd.service-xh9yyb` (systemd PrivateTmp of a service); `/tmp/systemd-private-0a7b3a17a5db4ac69ed1a928ea8b43f8-systemd-resolved.service-DZMWWd` (systemd PrivateTmp of a service).

| Size | Newest file | Path |
|---|---|---|
| 637.4 MB | 2026-09-24T20:47Z | `/tmp/claude-0/-root-ScreenReceipts/153dd02f-cec8-4458-9f9b-201f6a79938a` |
| 31.5 MB | 2026-09-24T23:55Z | `/tmp/XwwSkpxa-pt3EQt_Rzia3` |
| 16.7 MB | 2026-09-24T22:37Z | `/tmp/z-Yk888LuRP5efC27VCZB` |
| 14.9 MB | 2026-09-24T22:03Z | `/tmp/xlua_oLYwD3mDl58ZAtpz` |
| 14.7 MB | 2026-09-24T22:17Z | `/tmp/XpVg3E_hgyWKym9BfnBIg` |
| 14.0 MB | 2026-09-24T21:59Z | `/tmp/usTTXyjGi449x6DRTAx1Y` |
| 11.8 MB | 2026-09-25T00:40Z | `/tmp/gc9yYPd2V1ZaiQkBveySu` |
| 11.8 MB | 2026-09-25T00:35Z | `/tmp/TufhlkB_lQV2_0s40mMPd` |
| 11.8 MB | 2026-09-24T22:41Z | `/tmp/xtx28LwBNNQmV-uoH15Da` |
| 11.7 MB | 2026-09-24T22:28Z | `/tmp/VOBWKl37LyJcyXrlw8hdv` |
| 11.7 MB | 2026-09-24T23:57Z | `/tmp/NNseFT1YP6glQ8OyTaBHI` |
| 1.9 MB | 2026-09-24T22:38Z | `/tmp/2DOgLgmgZGygFbEguJGyb` |
| 1.9 MB | 2026-09-24T22:37Z | `/tmp/P8-dk6jR0s7iOpkTke0k6` |
| 1.6 MB | 2026-09-24T18:50Z | `/tmp/metro-file-map-1669e25375d064306fec86ec5699ca86-787e21b910323ccc82bab0d16d5ce9f4` |
| 1.6 MB | 2026-09-24T23:04Z | `/tmp/a5Z1jwD35Ot0TMnDOtndj` |
| 1.3 MB | 2026-09-24T22:06Z | `/tmp/jfml6czub59rFzXRlMRL-` |
| 1.3 MB | 2026-09-24T22:06Z | `/tmp/znnWITZj4SbYRSo54QsNQ` |
| 1.3 MB | 2026-09-24T22:06Z | `/tmp/j1zO_mdZGnXENWeQ06IAv` |
| 1.3 MB | 2026-09-24T22:06Z | `/tmp/puno6NkY8651FR79HvTeP` |
| 1.3 MB | 2026-09-24T22:06Z | `/tmp/3Kp9tD88akqaXxgekr1gT` |
| 1.3 MB | 2026-09-24T22:05Z | `/tmp/8GcGB4B2PGsfLzNfEYQx0` |
| 0.9 MB | 2026-09-24T21:38Z | `/tmp/4-uu6A5GF_pDGAjEmXFZD` |
| 0.8 MB | 2026-09-24T21:37Z | `/tmp/XGmTs9S8SBSrqZ7Wm3eQV` |
| 0.7 MB | 2026-09-24T22:01Z | `/tmp/c_ff9RQ2iAfhRuG2X7lOY` |
| 0.7 MB | 2026-09-24T21:39Z | `/tmp/MHiJEeeTpsnNSst-KrEnB` |
| 0.7 MB | 2026-09-24T21:39Z | `/tmp/gZbTJJN_uvJ6lWnzW1ip8` |
| 0.5 MB | 2026-09-24T23:16Z | `/tmp/JeQQlSnPmtyAHOwxvrXJk` |
| 0.5 MB | 2026-09-24T23:16Z | `/tmp/S8B55OLaiCG7RYNTZWoLU` |
| 0.5 MB | 2026-09-24T23:16Z | `/tmp/9oZBo1LlINxgbvoSVG5Ub` |
| 0.5 MB | 2026-09-24T23:17Z | `/tmp/ixiCZmx8kDh5_DOiIF9ug` |
| 0.5 MB | 2026-09-24T23:16Z | `/tmp/aADrTLW9EAW0GcLT6YR_V` |
| 0.5 MB | 2026-09-24T23:16Z | `/tmp/r7pcxHBXNVoGgNTaKem9V` |
| 0.5 MB | 2026-09-24T23:17Z | `/tmp/IjJc88ZeCRK81BLMwyBXi` |
| 0.5 MB | 2026-09-24T23:04Z | `/tmp/JpUjFyw5-mKXwVUaduOHX` |
| 0.5 MB | 2026-09-24T23:04Z | `/tmp/Z8zDosZB1vggqlYdq33lB` |
| 0.5 MB | 2026-09-24T22:54Z | `/tmp/0BZmguh67aEldrfUtN0xm` |
| 0.5 MB | 2026-09-24T22:54Z | `/tmp/0mKAAx1rPnKHIHeWKJqti` |
| 0.5 MB | 2026-09-24T22:05Z | `/tmp/6y8rlB-kYuZ-CFJrzgOZa` |
| 0.5 MB | 2026-09-24T22:05Z | `/tmp/Zv6Um5XHQxhEk9d0nxCUM` |
| 0.4 MB | 2026-09-24T22:18Z | `/tmp/B_xFMwyh0zwZeODkrncrM` |
| 0.4 MB | 2026-09-24T22:17Z | `/tmp/M2j9LK0THETEyo0UEcZkj` |
| 0.4 MB | 2026-09-24T22:18Z | `/tmp/Jy2IrCjPC1e1zlbl7or9P` |
| 0.4 MB | 2026-09-24T22:42Z | `/tmp/7NK_7iZkbcyGYKvcs6N0_` |
| 0.4 MB | 2026-09-24T23:56Z | `/tmp/gNtoxBvveuLlH98sRW7cx` |
| 0.4 MB | 2026-09-24T22:01Z | `/tmp/SAhkovIoM6Y6oTCDdTnUn` |
| 0.4 MB | 2026-09-25T00:10Z | `/tmp/9tHH0hp-vi6GwP-FVfBwb` |
| 0.4 MB | 2026-09-25T00:10Z | `/tmp/HklYa5gsiis3VyUFtBTzG` |
| 0.4 MB | 2026-09-24T22:01Z | `/tmp/kOwPw5V7Uf7_APfIHRKTx` |
| 0.3 MB | 2026-09-24T22:17Z | `/tmp/tIrsSJ_yPFfOei_6h-oox` |
| 0.3 MB | 2026-09-24T22:18Z | `/tmp/qHYOMo9g0eEPE5KSEyX96` |
| 0.3 MB | 2026-09-24T22:17Z | `/tmp/snE2poQ3JlgZkIG6BgIhC` |
| 0.3 MB | 2026-09-25T00:12Z | `/tmp/-I--f_Sf6cGGptaPAWZUJ` |
| 0.3 MB | 2026-09-25T00:12Z | `/tmp/QZdHO5zXsqv6pNWXEmFLY` |
| 0.3 MB | 2026-09-25T00:11Z | `/tmp/hBzdMv3gHpfkIUiRRhRJX` |
| 0.3 MB | 2026-09-25T00:11Z | `/tmp/csc7Wcw4B0gvQLqyB9eVf` |
| 0.3 MB | 2026-09-25T00:11Z | `/tmp/GfXOtKqFqDSZtKjmudNCE` |
| 0.3 MB | 2026-09-25T00:11Z | `/tmp/5dhTk4McLSlolU0aSyoxB` |
| 0.3 MB | 2026-09-25T00:10Z | `/tmp/9IthgyK3ETBHzK0Ur5eGq` |
| 0.3 MB | 2026-09-25T00:10Z | `/tmp/fQfMLgt7n9Ih5gP0VLIgB` |
| 0.3 MB | 2026-09-24T23:57Z | `/tmp/sUha9TDW-OK0lvjgVtWIK` |
| 0.3 MB | 2026-09-24T23:57Z | `/tmp/VIxAPF6fdULJJgo3mSKHi` |
| 0.3 MB | 2026-09-25T00:10Z | `/tmp/fVAqjYEEAMgsDqyCSdxyO` |
| 0.3 MB | 2026-09-24T23:56Z | `/tmp/q8DIy7NtFzXs1c10xnWRG` |
| 0.3 MB | 2026-09-24T22:39Z | `/tmp/b5pzHeaa50YUh-PNeHtvl` |
| 0.3 MB | 2026-09-24T23:56Z | `/tmp/_G7nXjiKRokR-9B-slAlV` |
| 0.3 MB | 2026-09-24T23:56Z | `/tmp/w2VFBWaU7rRfWyo-gUW-R` |
| 0.3 MB | 2026-09-24T23:56Z | `/tmp/Oz9olgeSJ2-0nY-jktLzE` |
| 0.3 MB | 2026-09-24T22:39Z | `/tmp/RRb5mGmBKDEuFCVma4IC6` |
| 0.3 MB | 2026-09-24T22:04Z | `/tmp/TwBH4HuHdRQsaE0LPjb40` |
| 0.3 MB | 2026-09-24T22:07Z | `/tmp/iWsNPHKTIvcAUBfvbw2kZ` |
| 0.3 MB | 2026-09-24T22:16Z | `/tmp/SkPLlYT4eYzLHnMKMxQlF` |
| 0.3 MB | 2026-09-24T22:18Z | `/tmp/uMatB9LgR_JUoXbMXXxeT` |
| 0.3 MB | 2026-09-24T23:16Z | `/tmp/efFydjNydEEjnyBCXsujW` |
| 0.3 MB | 2026-09-24T23:16Z | `/tmp/3GivTVDFXOeJ4aj8uQ3Q8` |
| 0.3 MB | 2026-09-24T22:06Z | `/tmp/LruYMt8WhxFLzdFrRmAAJ` |
| 0.3 MB | 2026-09-24T22:06Z | `/tmp/kzfJ_rx9S6xpENxA1nnVa` |
| 0.3 MB | 2026-09-24T22:40Z | `/tmp/QyQ3rArq3WehsclToB5Jt` |
| 0.2 MB | 2026-09-24T22:05Z | `/tmp/9NHgGJaFj-hDRVZrFl9ls` |
| 0.2 MB | 2026-09-24T23:56Z | `/tmp/U_qEta05zjvD3XE2k_rLE` |
| 0.2 MB | 2026-09-24T23:28Z | `/tmp/pyRKgmRWsqn_oxejKpkJz` |
| 0.2 MB | 2026-09-24T23:57Z | `/tmp/8NHpO-UrA9ThOc_HfaMUM` |
| 0.2 MB | 2026-09-24T22:11Z | `/tmp/-VW9P-7MHcylGEOrGKw3g` |
| 0.2 MB | 2026-09-24T23:56Z | `/tmp/7gGhde-WK6f0jgfx0ernM` |
| 0.2 MB | 2026-09-24T21:38Z | `/tmp/CcsSWUYgr37N5-GIvKgpb` |
| 0.2 MB | 2026-09-24T23:57Z | `/tmp/XurH2srEYDTGdRagwEU2H` |
| 0.2 MB | 2026-09-24T23:28Z | `/tmp/houV1mPZrcRvNhxgtEfjx` |
| 0.2 MB | 2026-09-24T21:39Z | `/tmp/xnkABXmupQpY_BnC4DHH3` |
| 0.2 MB | 2026-09-24T21:38Z | `/tmp/Esa-j90ckurCV_jaVnnlw` |
| 0.2 MB | 2026-09-24T21:38Z | `/tmp/0TNwgMvXB1pKGmgG6ubOC` |
| 0.2 MB | 2026-09-24T23:57Z | `/tmp/svHsYP1pa-4jrukO5aB7r` |
| 0.2 MB | 2026-09-24T23:57Z | `/tmp/zfPzRZ4sAxCalj2MeF4A8` |
| 0.2 MB | 2026-09-24T23:57Z | `/tmp/QhCze9sU9cddzMAhZG8TF` |
| 0.2 MB | 2026-09-24T21:38Z | `/tmp/VD8msuUaJ6d_I45Tjujqb` |
| 0.2 MB | 2026-09-24T21:37Z | `/tmp/cdsjS7ErLpUi74pMRndyW` |
| 0.2 MB | 2026-09-24T23:40Z | `/tmp/SVlFnbBgndYjiUxcTBjF3` |
| 0.2 MB | 2026-09-24T23:40Z | `/tmp/txnuFsab23yuI7YWSHAP_` |
| 0.2 MB | 2026-09-24T23:40Z | `/tmp/l6YN1rDpNk6wmQUzu55y7` |
| 0.2 MB | 2026-09-24T23:40Z | `/tmp/d714bMBiyA3htRIuc4XFc` |
| 0.2 MB | 2026-09-24T23:40Z | `/tmp/Z3dxnub-yWT3yrp1siJ1U` |
| 0.2 MB | 2026-09-24T23:40Z | `/tmp/TFqyzyd3PwAvZ2O968tk_` |
| 0.2 MB | 2026-09-24T22:11Z | `/tmp/O7m2E36Tc14EAzgTx_8wq` |
| 0.2 MB | 2026-09-24T22:11Z | `/tmp/ix3Y277SaHjVZ7Xth7nUI` |
| 0.2 MB | 2026-09-24T22:11Z | `/tmp/vrhM3FMjMmevsYJ_6lYPc` |
| 0.2 MB | 2026-09-25T00:37Z | `/tmp/vrSk0maaWHBJ1PgFGuT54` |
| 0.2 MB | 2026-09-25T00:37Z | `/tmp/0g04_wNGqag1oxzsu7XDy` |
| 0.2 MB | 2026-09-25T00:37Z | `/tmp/eBYGnQ_ZqpsT-QuPfnL-S` |
| 0.2 MB | 2026-09-24T21:39Z | `/tmp/xF6lH8yvIpQm9vdKfNGJW` |
| 0.2 MB | 2026-09-24T21:39Z | `/tmp/gm2PC-p6dJrebZRcgGMBR` |
| 0.2 MB | 2026-09-24T21:39Z | `/tmp/ijqLKEGvXde7nJJkHTOt-` |
| 0.1 MB | 2026-09-25T00:35Z | `/tmp/Pp2gX6dpLKp2O-Ymuh8gE` |
| 0.1 MB | 2026-09-25T00:35Z | `/tmp/shFxbBNFRnXxkEsfQDRbq` |
| 0.1 MB | 2026-09-24T22:06Z | `/tmp/pukrO7xfyu3dMDEvs9g5h` |
| 0.1 MB | 2026-09-24T22:27Z | `/tmp/9mdmwQFxwpFZ-Y5vUUcsC` |
| 0.1 MB | 2026-09-24T22:26Z | `/tmp/jiAMemRTGf6rNbG6qdeby` |
| 0.1 MB | 2026-09-24T22:15Z | `/tmp/Vea8aPiAunTiOAIA1nsta` |
| 0.1 MB | 2026-09-24T23:16Z | `/tmp/lg99zbW-FxmtZjLpSQF6I` |
| 0.1 MB | 2026-09-24T22:05Z | `/tmp/B9zKI9pd7vZtrfUG_jVp2` |
| 0.1 MB | 2026-09-24T23:16Z | `/tmp/jwNytPMDXMsJLX9dk4qZ0` |
| 0.1 MB | 2026-09-24T22:05Z | `/tmp/419cY2cneN6mCceDLqF0H` |
| 0.1 MB | 2026-09-24T23:16Z | `/tmp/W8B1kuOvfkr687ohrZqyP` |
| 0.1 MB | 2026-09-24T22:05Z | `/tmp/G3GYE98115PRFaRbx_68-` |
| 0.1 MB | 2026-09-24T23:16Z | `/tmp/LyGjlWiK6-akVXkgvlKTy` |
| 0.1 MB | 2026-09-24T22:07Z | `/tmp/LzGF7PvEDbp5apccR3VEB` |
| 0.1 MB | 2026-09-24T22:06Z | `/tmp/Rmim8rf7OrQ6LcPI8lOb6` |
| 0.1 MB | 2026-09-24T22:05Z | `/tmp/uEb7vdx7G8B7Bmf66gKRy` |
| 0.1 MB | 2026-09-24T23:16Z | `/tmp/9-Ji6LyzLpNv_yPaGhMSh` |
| 0.1 MB | 2026-09-24T22:07Z | `/tmp/QlxfGoe_RGG7zhR8I9OuW` |
| 0.1 MB | 2026-09-24T22:07Z | `/tmp/YVdsEHR_-Xv81Mk5zEB3H` |
| 0.1 MB | 2026-09-24T21:41Z | `/tmp/H-Tk2ubKk4vi2E5RHRia7` |
| 0.1 MB | 2026-09-24T22:19Z | `/tmp/bLlq2Zq2a4Ueo3lDJzn5-` |
| 0.1 MB | 2026-09-24T23:57Z | `/tmp/LBl7Le_8JuG_zhPe_O2TP` |
| 0.1 MB | 2026-09-24T23:57Z | `/tmp/0z6b5pfx88qg421ToUi-C` |
| 0.1 MB | 2026-09-24T23:27Z | `/tmp/OosHH66qRVHtbPZ8ifDAI` |
| 0.0 MB | 2026-09-24T21:42Z | `/tmp/z40AzX5DPBNcQ3-CEFd3Z` |
| 0.0 MB | 2026-09-24T22:18Z | `/tmp/4OX3XCMS5mHEkX32jzrim` |
| 0.0 MB | 2026-09-24T22:18Z | `/tmp/wWQolSkP2ddhQjM72JIGV` |
| 0.0 MB | 2026-09-24T17:11Z | `/tmp/claude-0/bash-edit-diff/7880896126798636636-7463134997411712041-2b057181b6def571` |
| 0.0 MB | 2026-09-24T22:06Z | `/tmp/NUBLycBFznHBIwFVbDgO4` |
| 0.0 MB | 2026-09-25T00:40Z | `/tmp/-r04O7WZvSFt8Q4aIZc2-` |
| 0.0 MB | 2026-09-24T22:07Z | `/tmp/EaZz8ZkEjvvqDiqQT4ZKs` |
| 0.0 MB | 2026-09-24T23:39Z | `/tmp/AGaq7YGC0ypzLIYHlftwM` |
| 0.0 MB | 2026-09-24T23:57Z | `/tmp/Hy2XLh8U4K3tCxdew_tRv` |
| 0.0 MB | 2026-09-24T23:56Z | `/tmp/_nTTPKWAmrFUpHJJJA-Hp` |
| 0.0 MB | 2026-09-24T23:56Z | `/tmp/crmal-cmKp3MCNIFGYbny` |
| 0.0 MB | 2026-09-24T22:29Z | `/tmp/Qoo1RURN2DOCpgWTJgvoz` |
| 0.0 MB | 2026-09-24T19:59Z | `/tmp/sogojet-tsc.log` |
| 0.0 MB | 2026-09-24T22:46Z | `/tmp/next-panic-cb0e9ca135bdd35d6951519e3e58e9e2.log` |
| 0.0 MB | 2026-09-24T22:46Z | `/tmp/next-panic-68db4c78b230cb50b9ca51e27f9080f9.log` |
| 0.0 MB | 2026-09-24T21:30Z | `/tmp/mac-push.log` |
| 0.0 MB | 2026-09-24T20:46Z | `/tmp/claude-0/-root-ScreenReceipts/cb61e222-5f7b-4ecb-8cc1-f260efce043d` |
| 0.0 MB | 2026-09-24T16:38Z | `/tmp/snap-private-tmp` |
| 0.0 MB | 2026-09-24T16:38Z | `/tmp/.font-unix` |
| 0.0 MB | 2026-09-24T16:38Z | `/tmp/.XIM-unix` |
| 0.0 MB | 2026-09-24T16:38Z | `/tmp/.X11-unix` |
| 0.0 MB | 2026-09-24T16:38Z | `/tmp/.ICE-unix` |

## Simulator and the repro rig

The iPhone 16 simulator (6A2212F7-BFA5-4D4D-80F9-D226E2EA73A7) was used for the iOS stall and screen-locked handover tests. Its Safari data container went from 356 MB to 31 MB. Removed, inside Safari's own container only (the device was not erased, other apps' data untouched):

| What | Size |
|---|---|
| `tmp/`: the SafariAutomation profiles of the test runs (2026-09-25 to 09-28), each a seeded High Desert IndexedDB (6 MB) and up to 40 MB of MediaCache | 311 MB |
| `Library/Caches` | 5.1 MB |
| `Library/WebKit/com.apple.mobilesafari/WebsiteData/Default` (site storage) | 8.3 MB |

After the pinned-copy run that followed (docs/ios-stalls.md), the same three places were cleared again: 40 MB of tmp and 0.6 MB of caches, leaving the container at 30 MB.

On the VPS: the repro server on 127.0.0.1:3020 (node, pid 2698243) and its reverse tunnel to the Mac (`ssh -R 3020`, pid 2490507) were stopped, and stopped again after that run. Their files (0.9 MB, including the stall logs cited in `docs/ios-stalls.md`) stay in the session scratchpad.


## Result: the pins are at target

The warm job was rerun after `deploy-mirror.sh` shipped the pins-first code
(15144c1). The floor was not touched: `floorBytes` is still 10 GiB.

| Run (UTC) | Pinned | Bytes | Fetched | Failed | Unpinned | Free after |
|---|---|---|---|---|---|---|
| 04:10 nightly, old code, before the cleanup | 310 | 15,094,058,709 | 0 | 0 | 8 | not recorded; it stopped at the floor (`stopped-at-floor`) |
| 06:47 | 321 | 15,500,891,897 | 11 | 14 | 0 | 14.26 GB |
| 06:49 | **332** | **16,105,994,591** | 14 | 0 | 3 | 13.66 GB |

The target is 332 episodes, 16,105,994,591 bytes, inside the 15 GiB budget
(16,106,127,360 bytes), and `targetMissing` is 0. The 14 failures at 06:47
were all `HTTP 500` from archive.org's datanode on a whole-file GET. The same
node answered a ranged GET for the same file with 206 at the same moment, and
each of the 14 fetched cleanly two minutes later. The job skips a failed fetch
rather than retrying (by design: the next night picks it up), so the second
run is the retry. The 3 unpinned at 06:49 were out-of-top pins dropped to
make room for top episodes that then fit, which is the pins-first rule.
