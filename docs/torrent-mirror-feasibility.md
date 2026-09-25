# Torrent-backed mirror: feasibility

*Measured 2026-09-24 from this server (187.77.218.14). Tools:
`scripts/build-torrent-index.mjs`, `services/mirror/measure-peers.mjs`.*

The question: when archive.org is down, can High Desert keep playing shows by
falling back to BitTorrent, and how much of the catalog would that realistically
cover?

**Short answer: BitTorrent gives us a verifiable file format and a way to seed
back, but nobody else holds these files. The fallback that actually works is our
own warm cache — pinned whole files on this server, fetched while archive.org is
up. In a real archive.org outage, pinned shows play and unpinned ones do not.**
We built it anyway (the mandate said to proceed either way), sized to that finding.

## 1. archive.org's own torrent covers zero episodes

archive.org publishes one torrent per item. The item behind the whole catalog,
`ultimate-ultimate-art-bell-collection`, has one (btih `ec92fe3b…e23f`, created
2024-03-05, 512 KiB pieces), and it contains **2 files, both metadata, and 0 of
the 1,312 MP3s**. It was generated before the audio was uploaded and never
regenerated. `data/torrents/index.json` records this (`coverage.inATorrent: 0`).

So there was nothing to join. We generated our own torrents instead:
**one single-file torrent per episode**, hashed from the exact bytes archive.org
serves:

| | |
|---|---|
| Episodes hashed | 1,312 of 1,312 (two needed a retry after an archive.org HTTP 500) |
| Catalog size | 59.4 GB — mean 46.3 MB, largest 268 MB, smallest 181 KB |
| Piece length | 256 KiB |
| Webseed | BEP-19 `url-list` = the episode's archive.org URL |
| Time to hash | about 70 minutes, at 10–25 MB/s from archive.org |
| Output | `data/torrents/episodes.json` (committed); 7.7 MB of `.torrent` files in `/var/lib/highdesert-mirror/torrents` |

Infohashes are deterministic. Anyone running the script against the same bytes
gets the same infohash, so a future community seeder would land on the same swarm.

## 2. Outside peers: none

Method (`services/mirror/measure-peers.mjs`): 50 episode infohashes, evenly spaced
through the most-played-first list, plus archive.org's item torrent. For each one,
25 seconds of mainline-DHT `get_peers` and an announce to both trackers in our
magnet links. The announce says `left > 0`, so we never claim to hold anything.
Our own address is excluded.

Two controls in the same run. Without them, "zero peers" would say nothing:

- **Positive:** the Ubuntu 24.04.3 desktop ISO torrent. If the instrument can see
  peers at all, it sees them there.
- **Negative:** 50 infohashes of random bytes, which nobody can hold. Some DHT
  nodes answer `get_peers` for any hash (indexers, spies); whatever "peer" rate
  random hashes get is noise.

| | DHT "peers" | Tracker seeders (`complete`) | Hashes with any outside peer |
|---|---|---|---|
| Ubuntu ISO (positive control) | 539 | 45 + 33 | 1 of 1 — **585 outside peers** |
| Our 50 episodes + IA item | ≤1 each | **0 on every hash** | 11 of 51 |
| 50 random hashes (negative control) | ≤1 each | 0 | 8 of 50 |

The episodes' "peers" are the random hashes' noise. The rates match (22% vs 16%),
each is a single DHT answer, and 3 of the 6 addresses that "had" one of our
episodes also "had" random bytes. No tracker reported a single seeder for any
episode. The only `incomplete: 1` is our own announce.

**Conclusion: outside peers = 0.** The torrents are useful for piece-hash
verification, for the magnet link, and for seeding back what we hold. They are
not a source.

### The first measurement was wrong, and why

The first two runs reported `dhtNodes: 0`. The DHT had never bootstrapped, so
every DHT count was a zero it could not help reporting. The Ubuntu control
exposed it: 0 DHT peers for one of the best-seeded torrents there is.

Cause: `bittorrent-dht` listens on a udp4 socket but passes its bootstrap
*hostnames* to Node's resolver. On this server that resolver answers
`dht.transmissionbt.com` with an IPv6 address first, which a udp4 socket cannot
reach. It says nothing, and reports "ready" with an empty routing table. The
other two default routers (`router.bittorrent.com`, `router.utorrent.com`) no
longer answer a KRPC ping at all.

`services/mirror/lib/bootstrap.mjs` now resolves the bootstrap list to IPv4
itself and adds `dht.libtorrent.org:25401`. The gateway uses it too, so without
this fix the gateway would have had no DHT either. Test: `test/bootstrap.test.mjs`;
mutation `mirror-dht-ipv4`. After the fix: 149–171 DHT nodes and 539 control peers.

## 3. What the mirror can therefore do

| archive.org state | Pinned show (warm cache) | Unpinned show |
|---|---|---|
| Up, but the listener cannot reach it | plays from our disk | filled from archive.org via this server, and it plays (since §6: nginx's cache, not the gateway) |
| **Actually down** | **plays from our disk** | no source at all: the fill fails, then `PlaybackErrorDialog` — and in outage mode it is refused at the tap |

The warm cache is therefore the product. How much it covers, using the last 90
days of `play_events` (2,262 plays over 741 episodes, since 2026-07-28 when the
event log began):

| Pin budget | Episodes pinned | Share of 90-day plays on a pinned show |
|---|---|---|
| 5 GB | 114 | 44.4% |
| 10 GB | 225 | 63.4% |
| **15 GB (chosen)** | **334** | **76.3%** |
| 20 GB | 450 | 86.5% |

These shares are in-sample: the pins are chosen from the same 90 days they are
scored against, so the true hit rate during a future outage will be somewhat
lower. The nightly refresh keeps the choice current.

### Chaos run on production (2026-09-25, `e2e/chaos-mirror.spec.ts`)

Headless Chromium against https://highdesert.space, with every archive.org host
aborted in the page. Stats writes were answered in the page, so nothing reached
the production database. Three runs; the last one is below, and the earlier
two were within the same range (331–469 ms pinned, 407–665 ms unpinned).

| Case | What happened | Time to first audio |
|---|---|---|
| Pinned show ("September 11th Coverage") | archive.org request aborted → `network-error` → same element moved to `/mirror/…`, `currentTime` advancing, VIA MIRROR shown | 469 ms |
| Unpinned show ("Woolly Mammoth Discovery", 9 MB) | same path; the gateway filled it from the archive.org webseed on the server side | 665 ms |
| Next start once archive.org is known down | straight to `/mirror/…`, **no** media request to archive.org | 385 ms |

The unpinned case measures the listener's route to archive.org being broken,
not a real outage: the server could still reach archive.org. In a real outage
that show would return 503 after 15 s (see the table above).

Not verified: iOS Safari's activation rules on a real device. The unit test
covers the rule (a `play()` refused after the swap raises the error dialog,
whose *Try Again* is a real gesture). No device test was run.

## 4. Sizing against this box

- **Disk:** 96 GB, 34 GB free. The gateway keeps a 10 GB disk-free floor, which
  binds before the 20 GB unpinned cap. Pins (≤15 GB) are exempt from eviction but
  the warm job also stops at the floor.
- **Transfer:** the Hostinger KVM 2 plan allows 8 TB/month (8,192,000 MB, read
  from the plan). Seeding is capped at 2 MB/s, about 5.2 TB/month if saturated,
  which it will not be with no outside peers. Serving listeners goes through
  nginx: 25 plays/day at ~46 MB is about 1.2 GB/day even if every play used the
  mirror.
- **CPU:** *(superseded by §6: there is no gateway; the warm job runs at
  `CPUQuota=10%`, `Nice=19`, idle I/O.)* `CPUQuota=50%`, `IOWeight=20`, `Nice=5` on the gateway. The warm job
  skips itself when hypervisor steal is over 20%, because the 2026-09-22 episode
  ran near 90%. `highdesert-status` reports steal (WARN >20%, FAIL >50%).

## 5. What would change the answer

- **archive.org regenerating the item torrent with the MP3s.** Then its swarm and
  its webseeds would be a second source for everything. `build-torrent-index.mjs`
  re-reads the item torrent each run and would report `inATorrent > 0`.
- **Community seeders.** The magnet link in each episode sheet carries our
  deterministic infohash (and, until §6, an `x.pe` hint). Anyone who seeds those
  files joins the same swarm. Since §6 nothing here would find them; §6 says how
  to bring the client back if that swarm ever exists.

## 6. Torrent client removed (2026-09-25)

**Why.** The gateway (`highdesert-mirror.service`, webtorrent on
127.0.0.1:3004) seeded the 338 pinned episodes back to a swarm that, per §2,
has no one in it. Measured with `pidstat` on the unit: **46.8% of a core**
sustained while seeding, **1.5%** with seeding switched off (`MIRROR_SEED=0`,
the stop-gap deployed the same morning). A third of a two-vCPU box, spent
announcing files nobody asks for, on the box that also serves five live
sites. With no outside peers, BitTorrent brought nothing the mirror used:
every byte it ever served came from our disk or from the archive.org webseed.

**What replaced it.** No process at all. nginx does the whole job, from
configuration rendered by `services/mirror/lib/nginx.mjs`:

| Request | Served by |
|---|---|
| `/mirror/{fileHash}`, pinned | `/var/lib/highdesert-mirror/pins/{fileHash}`, straight off disk; nginx's own 206 / 416 |
| `/mirror/{fileHash}`, not pinned | `proxy_cache` in `/var/cache/highdesert-mirror/proxy` (1 MiB slices, 20 GB, 10 GB `min_free`), filled from `archive.org/download/…` through a unix-socket server that follows the 302 to the storage node |
| `/mirror/{fileHash}`, not in the catalog | 404 — `/var/lib/highdesert-mirror/catalog/{fileHash}` must exist |
| `/mirror/manifest` | `/var/lib/highdesert-mirror/manifest.json`, written atomically by the warm job |
| `/mirror/magnet/{fileHash}` | `/var/lib/highdesert-mirror/catalog/{fileHash}` (static JSON) |

The nightly warm job is a plain HTTP download from archive.org, still
verified piece by piece against the episode's `.torrent` before it is renamed
into `pins/`. The torrents stay: they are the verification, and the magnet
links still work — with archive.org as the webseed, any client can fetch.

The one-time move of the gateway's 339 verified files is
`services/mirror/migrate.mjs` (renames on the same filesystem; nothing
re-downloaded). What an outage looks like is unchanged: pinned shows play,
unpinned ones do not (the fill needs archive.org), and outage mode refuses
those at the tap.

**Bringing the torrent client back** — only if a real swarm appears, i.e. the
§2 measurement run again finds outside seeders on our infohashes (the tool,
`services/mirror/measure-peers.mjs`, is in the same commit as the gateway):

1. Restore the code from the parent of the removal commit. The removal is
   `1ddc13a` on branch `mirror/nginx` (on `main`, find it with
   `git log --diff-filter=D --format='%h %s' -- services/mirror/server.mjs`):
   `git checkout 1ddc13a~1 -- services/mirror deploy/highdesert-mirror.service scripts/deploy-mirror.sh deploy/nginx/highdesert.conf deploy/highdesert-mirror-warm.service`.
   That brings back `server.mjs`, the gateway/cache/serve/client-options/
   bootstrap/range libs, `measure-peers.mjs`, the `webtorrent` dependency and
   lock, the unit, and the deploy script that installs them — and their tests
   (`services/mirror/test/{gateway,startup,no-seed,bootstrap,manifest}.test.mjs`)
   and mutations (`git show 1ddc13a -- scripts/mutate-check.mjs`).
2. Before deploying, move the pins back to where the gateway reads them:
   `runuser -u hdmirror -- env MIRROR_CACHE_DIR=/var/cache/highdesert-mirror MIRROR_STATE_DIR=/var/lib/highdesert-mirror MIRROR_INDEX=/opt/highdesert-mirror/episodes.json node /opt/highdesert-mirror/migrate.mjs --reverse`
   (`data/<infohash>/<file>` + `.complete`, and `pins.json`).
3. The unit is `highdesert-mirror.service` (user `hdmirror`, 127.0.0.1:3004,
   `CPUQuota=50%`, `MemoryMax=700M`). Seeding is `MIRROR_SEED=1` — the only
   reason to bring it back; leave it `0` and there is no reason to.
4. Inbound torrent ports in ufw: `6881/tcp`, `6881/udp` (uTP), `6882/udp` (DHT).
   The old `deploy-mirror.sh` opens them.
5. The vhost's `/mirror/` goes back to `proxy_pass http://127.0.0.1:3004`
   (restored with the file in step 1); remove the
   `/etc/nginx/highdesert-mirror/` includes.
6. `highdesert-status`'s `mirror` line read `/mirror/health` on 3004 and
   counted peers; restore it from the same commit (`scripts/status.sh`), and
   keep the `cpu` line — it is what would catch the 47% again.

Within one deploy of the removal, `bash scripts/deploy-mirror.sh --rollback`
does steps 2–5 automatically (it keeps the gateway's copy in
`/opt/highdesert-mirror.prev`).
