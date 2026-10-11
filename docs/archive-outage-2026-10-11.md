# archive.org's /download failing, 2026-10-11

## What happened

From about 15:45 UTC on 2026-10-11, archive.org's `/download/{identifier}/{file}`
for this catalog:

- redirected every caller to one cache node, `dn720703.ca.archive.org`, which
  answered 500 or 502. The VPS and a home connection (the Mac) got the same
  redirect and the same 502, so this was not aimed at this server;
- and then answered 502 itself for many files, with archive.org's overload
  page ("Sorry, we're kinda busy ... our servers are overloaded").

A sample of 20 catalog files at about 16:00 UTC: **1 played**. The metadata API
answered slowly (24 s) or not at all. At 16:23, 7 of 10 played again.

The item's own storage servers, named in its metadata (`d1`/`d2`:
`ia800503.us.archive.org` and `ia600503.us.archive.org`, `dir`
`/35/items/ultimate-ultimate-art-bell-collection`), served the same files with
a `206` in under half a second throughout.

The catalog scan (`scripts/scan-catalog-audio.mjs`) saw it first. Its error
rows went from 0 to 117 in ten minutes (15:50 to 16:00), and it was stopped
at once in case its six parallel downloads were part of the load.

## Why the site did not notice

- **The health probe checks the API, not the files.** `server-verdict.ts`
  HEADs `https://archive.org/metadata/`, which answered (`404` counts as up).
  So `/api/archive/health` said `up: true` throughout, and outage mode stayed
  off.

  That is the right outcome now: outage mode refuses every show the mirror has
  not pinned. With the fallback below, the mirror can serve any show while the
  item's servers are up, so refusing them would be worse. It does mean the
  banner never says archive.org is struggling when only `/download` is.
- **The mirror could not rescue unpinned shows.** Its fill follows `/download`'s
  302, which pointed at the failing node, and the slice retries went down the
  same path. Pins (served off disk) were fine.

Listener impact was small only because traffic was low (Sunday morning,
Pacific): 4 failures in the 15:00 hour, 3 rescued by the mirror.

## What changed

- `data/archive-items.json` (`scripts/archive-items.mjs`) holds each collection's
  own servers and directory, fetched one field at a time
  (`/metadata/{id}/d1`): the whole metadata of the big collection timed out
  while archive.org was overloaded.
- **The mirror's fill falls back to the collection's own server**
  (`services/mirror/lib/nginx.mjs`, `@hd_mirror_direct`):
  - a 5xx from `/download`, or from the node it redirects to, is fetched from
    `https://{d1}{dir}/{file}`;
  - a redirect off archive.org is still never followed; the own server answers
    instead;
  - the fill hop's next try (`proxy_next_upstream`) starts again from
    `/download`.

  `services/mirror/test/nginx.test.mjs` runs it in a real nginx against a node
  that answers 502 to everything and a `/download` that answers 502 itself.
- So when archive.org fails, a listener's watchdog fails over to `/mirror/`,
  and the mirror can now serve the show from the item's own server rather
  than only from a pin.
- The scripts that read whole files (the catalog scan, the station's pre-air
  walk, `repair-episode.mjs`) try `/download` first, then the own servers.

## Not changed

- The health probe. See above. If it should ever test the download path, it
  must not switch on outage mode for a partial `/download` failure the mirror
  can now absorb.
- The client still streams from `/download` first. A listener on a broken node
  waits for the watchdog: a `network-error` comes at once, a stall after the
  load deadline (12 s).
