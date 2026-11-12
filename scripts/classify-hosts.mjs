#!/usr/bin/env node
/**
 * Who hosted each catalog show (docs/hosts.md). The live station airs only
 * Art Bell's own nights; this decides which those are.
 *
 *   node scripts/classify-hosts.mjs <episodes.json>
 *
 * `<episodes.json>` is https://artbellarchive.org/episodes.json, the Art Bell
 * Archive's list of Art's broadcasts (built from artbell.com's own show
 * logs), saved locally. Each entry names the archive.org file it is, so the
 * join is by file name, never by guessing from a date.
 *
 * - A show the archive lists, and whose description does not say someone
 *   else hosted it, is Art's.
 * - A show the archive lists with a guest host (its description opens
 *   "Guest host Hilly Rose welcomes ...") is not.
 * - A show the archive does not list is decided by hand in REVIEWED below,
 *   with the reason. A new catalog show that is neither listed nor reviewed
 *   stops the script: classify it before it can go on the air.
 *
 * Writes data/hosts.json (every show, with its evidence) and
 * src/data/not-art-hosted.json (the station's exclusion list, what the
 * schedule imports). src/lib/live/__tests__/hosts.test.ts holds them to the
 * catalog.
 *
 * Why (2026-11-12): the station aired "2001-11-12 - Coast to Coast AM with
 * Art Bell - Eugene Mallove" at 2:11 AM Pacific. The file name says Art; the
 * night was George Noory's, and the phone lines said so within minutes. The
 * archive.org collection labels every file "with Art Bell".
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ART = "Art Bell";

/**
 * Catalog shows the archive does not list, decided by hand (2026-11-12).
 * `host: "Art Bell"` only where the archive has the same night under another
 * file (a different rip, a split hour) or the same broadcast on another
 * date; anything unverified stays off the air.
 */
const REVIEWED = {
  "1994-03-12 - Coast to Coast AM with Art Bell - The Philadelphia Experiment - Al Bielek.mp3": [ART, "archive lists 1994-03-12 Al Bielek, Philadelphia Experiment"],
  "1994-07-04 - Dreamland with Art Bell - The Reptilian Connection - John Rhodes.mp3": [ART, "archive lists the same broadcast, 1995-06-18 Human Reptilian Connection, John Rhodes"],
  "1997-02-19-Art-Bell-SIT-Jim-Forbes-Strange-Universe.mp3": [ART, "archive lists 1997-02-19 Strange Universe, Jim Forbes"],
  "1998-01-20 - Coast to Coast AM with Art Bell - Open Lines - new Phoenix Lights testimonies (hour 1).mp3": [ART, "archive lists 1998-01-20 Open Lines, Phoenix Lights"],
  "1998-03-05 - Coast to Coast AM with Art Bell - Bruce Rux - Hollywood and UFOs.mp3": [ART, "archive lists 1998-03-05 Bruce Rux (m4a rip)"],
  "1998-12-18 - Coast to Coast AM with Art Bell - Linda Howe - Majestic 12.mp3": [ART, "archive lists 1998-12-20 Majestic 12, Linda Moulton Howe"],
  "1999-01-25 - Coast to Coast AM with Art Bell -  William Thomas - Chemtrails, HAARP, other topics.mp3": [ART, "archive lists 1999-01-25 William Thomas"],
  "1999-03-07 - Coast to Coast AM with Art Bell - Robert AM Stephens.mp3": ["unknown", "not in the archive, no show with this guest on or near the date"],
  "1999-03-08 - Coast to Coast AM with Art Bell - Kevin Ryerson - Intuitive.mp3": [ART, "archive lists 1999-03-08 with Kevin Ryerson"],
  "1999-04-09 - Dreamland with Art Bell - Fire in the Sky - Travis Walton - Mike Rogers.mp3": [ART, "archive lists the same broadcast, 1996-06-23 Travis Walton & Mike Rogers"],
  "1999-07-13 - Coast to Coast AM with Art Bell -  Dr. Paul Moller - Moller 'Skycar'.mp3": [ART, "archive lists 1999-07-13 Dr. Paul Moller"],
  "1999-07-15 - Coast to Coast AM with Art Bell - Michio Kaku.mp3": [ART, "archive lists 1999-07-15 Dr. Michio Kaku"],
  "1999-08-11 - Coast to Coast AM with Art Bell - Tim Hughes - Sylvia Browne - Glenn Kimball - Linda Moulton Howe.mp3": [ART, "archive lists 1999-08-11 Sylvia Browne"],
  "1999-12-00 - Coast to Coast AM with Art Bell -  Best Sound Clips.mp3": [ART, "clips from Art's own shows"],
  "2000-04-26 - Coast to Coast AM with Art Bell -  Art's Farewell. Michio Kaku.mp3": [ART, "archive lists 2000-04-26 Art's Farewell"],
  "2001-11-12 - Coast to Coast AM with Art Bell - Eugene Mallove - Infinite Energy Magazine.mp3": ["George Noory", "not in the archive; listeners on the phone lines named George Noory when it aired, 2026-11-12"],
  "2002-02-14 - Coast to Coast AM with Art Bell - Philip Tierno MD - Bioterrorism, Secret Life of Germs.  Jim Berkland - Earthquake Predictions.mp3": [ART, "archive lists 2002-02-14 Jim Berkland and Philip Tierno"],
  "2002-02-19 - Coast to Coast AM with Art Bell - Jim Larranaga - Weather Control.mp3": ["unknown", "not in the archive, no show with this guest"],
  "2002-07-15 - Coast to Coast AM with Art Bell - Bishop Sean Manchester - Hunting Vampires.mp3": ["unknown", "not in the archive on or near the date (Art had Sean Manchester on 2001-08-23); George Noory filled in often in 2002"],
  "2002-09-22 - Coast to Coast AM with Art Bell - Jesus' Lost Years in India - Edward T. Martin.mp3": ["unknown", "not in the archive; a Sunday in 2002, George Noory's night"],
  "2002-11-11 - Coast to Coast AM with Art Bell - Spiritual Messenger - Neale Donald Walsch.mp3": ["unknown", "not in the archive; a weeknight after Art handed the weeknights to George Noory (October 2002)"],
  "2013-11-12 - Gabcast - Art Calls into the Gabcast.mp3": [ART, "Art himself, calling in to the Gabcast (like his Larry King Live appearance)"],
};

/** Midnight in the Desert (2015) is Art's own show; the archive lists it under its own files. */
const ART_OWN_COLLECTIONS = new Set(["Art-Bell_Midnight_In_the_Desert"]);

/** A description saying someone other than Art hosted, and who. */
function guestHost(description) {
  const text = description.replace(/<[^>]+>/g, "");
  const m =
    /^(?:Guest host|Fill-in host)\s+([A-Z][\w.]*(?:\s[A-Z][\w.]*)*)/.exec(text) ??
    /^([A-Z][\w.]*(?:\s[A-Z][\w.]*)*) hosts alongside/.exec(text) ??
    /^Art Bell hands the microphone to (?:his wife )?([A-Z][\w.]*(?:\s[A-Z][\w.]*)*)/.exec(text);
  return m ? m[1] : null;
}

function main() {
  const src = process.argv[2];
  if (!src) {
    console.error("usage: node scripts/classify-hosts.mjs <artbellarchive episodes.json>");
    process.exit(2);
  }
  const episodes = JSON.parse(readFileSync(src, "utf8"));
  const catalog = JSON.parse(readFileSync(join(ROOT, "public/seed/library.json"), "utf8"));

  const byFile = new Map();
  for (const e of episodes) {
    if (!e.archive_audio_url) continue;
    const file = decodeURIComponent(e.archive_audio_url.slice(e.archive_audio_url.lastIndexOf("/") + 1));
    byFile.set(file, e);
  }

  const art = {};
  const notArt = {};
  const unclassified = [];
  for (const row of [...catalog].sort((a, b) => (a.fileHash < b.fileHash ? -1 : 1))) {
    const e = byFile.get(row.fileName);
    if (e) {
      const host = guestHost(e.description ?? "");
      if (host) notArt[row.fileHash] = { host, evidence: `artbellarchive.org: "${e.title}", guest host` };
      else art[row.fileHash] = `artbellarchive.org: ${e.slug}`;
      continue;
    }
    if (ART_OWN_COLLECTIONS.has(row.archiveIdentifier)) {
      art[row.fileHash] = `Midnight in the Desert, Art's own show (${row.archiveIdentifier})`;
      continue;
    }
    const r = REVIEWED[row.fileName];
    if (!r) {
      unclassified.push(row.fileName);
      continue;
    }
    if (r[0] === ART) art[row.fileHash] = `reviewed: ${r[1]}`;
    else notArt[row.fileHash] = { host: r[0], evidence: `reviewed: ${r[1]}` };
  }
  if (unclassified.length) {
    console.error(`${unclassified.length} catalog show(s) are neither in the archive nor reviewed. Add each to REVIEWED:`);
    for (const f of unclassified) console.error(`  ${f}`);
    process.exit(1);
  }

  writeFileSync(
    join(ROOT, "data/hosts.json"),
    JSON.stringify(
      {
        about: "Who hosted each catalog show. Generated by scripts/classify-hosts.mjs from artbellarchive.org/episodes.json; see docs/hosts.md.",
        art,
        notArt,
      },
      null,
      1,
    ) + "\n",
  );
  writeFileSync(join(ROOT, "src/data/not-art-hosted.json"), JSON.stringify(Object.keys(notArt).sort(), null, 1) + "\n");
  console.log(`Art Bell: ${Object.keys(art).length}. Someone else, or unverified: ${Object.keys(notArt).length}.`);
  for (const [h, v] of Object.entries(notArt)) console.log(`  ${v.host.padEnd(16)} ${h.replace(/^archive:[^:]+:/, "")}`);
}

main();
