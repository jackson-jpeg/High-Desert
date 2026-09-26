/**
 * Caller names and phone lines, in the manner of Coast to Coast AM under Art
 * Bell: "Night Owl in Pahrump", "West of the Rockies caller", "First-Time
 * Caller from Tonopah".
 *
 * Lines: the real show took calls on numbered lines and on themed ones — West
 * of the Rockies, East of the Rockies, the Wildcard Line, First-Time Callers,
 * the International Line, and the Area 51 line from the famous 1997 call. A
 * caller's line is fixed by their client ref, so the same household is always
 * on the same line and the label means something across a night.
 */

import { randomInt } from "node:crypto";
import { MAX_NAME_CHARS } from "./config.mjs";

export const LINES = [
  "Line 1",
  "Line 2",
  "Line 3",
  "Line 4",
  "Line 5",
  "Line 6",
  "West of the Rockies",
  "East of the Rockies",
  "Wildcard Line",
  "First-Time Callers",
  "International Line",
  "Area 51 Line",
];

/** Which line a caller is on: a stable function of their client ref (64 hex chars). */
export function lineFor(clientRef) {
  const n = Number.parseInt(String(clientRef).slice(0, 8), 16);
  return Number.isFinite(n) ? n % LINES.length : 0;
}

export const EPITHETS = [
  "Night Owl",
  "Long-Haul Trucker",
  "Desert Rat",
  "Insomniac",
  "Night Shift Nurse",
  "Graveyard Shift Guard",
  "Ham Radio Operator",
  "Skywatcher",
  "Rancher",
  "Prospector",
  "Lighthouse Keeper",
  "Retired Engineer",
  "Cab Driver",
  "Short-Wave Listener",
  "Stargazer",
  "Road Warrior",
  "Casino Dealer",
  "Truck Stop Waitress",
  "Former Government Worker",
  "Amateur Astronomer",
  "Coyote Hunter",
  "Night Watchman",
  "Drifter",
  "Farmhand",
  "Radio Tinkerer",
  "Crop Circle Chaser",
  "Bigfoot Hunter",
  "Time Traveler",
  "Remote Viewer",
  "Border Collie Owner",
];

export const PLACES = [
  "Pahrump",
  "Tonopah",
  "Rachel",
  "Area 51",
  "Beatty",
  "Ely",
  "Winnemucca",
  "Elko",
  "Barstow",
  "Baker",
  "Death Valley",
  "Roswell",
  "Sedona",
  "Flagstaff",
  "Kingman",
  "Twentynine Palms",
  "Needles",
  "Bishop",
  "Lone Pine",
  "Amarillo",
  "Truth or Consequences",
  "Marfa",
  "Moab",
  "Tucumcari",
  "Mount Shasta",
  "Point Pleasant",
  "Dulce",
  "Joshua Tree",
  "Goldfield",
  "Hawthorne",
  "Mojave",
  "Laughlin",
  "Mesquite",
  "Boulder City",
  "Quartzsite",
  "Alamogordo",
  "the High Desert",
  "the Mojave",
  "the Ozarks",
  "the Outback",
];

const THEMED = [
  () => "West of the Rockies caller",
  () => "East of the Rockies caller",
  () => "Wildcard Line caller",
  () => "International Line caller",
  () => "Area 51 Line caller",
  (p) => `First-Time Caller from ${p}`,
  (p) => `Caller from ${p}`,
];

const pick = (list, rnd) => list[rnd(list.length)];

/**
 * A fresh caller name. `rnd(n)` returns an integer in [0, n) — crypto by
 * default, injectable for tests. Never longer than MAX_NAME_CHARS. Most names are "<epithet> in <place>"; about
 * one in five is a themed line caller.
 */
export function randomCallerName(rnd = randomInt) {
  for (let i = 0; i < 100; i++) {
    const name = rnd(5) === 0
      ? pick(THEMED, rnd)(pick(PLACES, rnd))
      : `${pick(EPITHETS, rnd)} in ${pick(PLACES, rnd)}`;
    // A generated name obeys the same length limit as a chosen one.
    if (name.length <= MAX_NAME_CHARS) return name;
  }
  return `${pick(EPITHETS, rnd)} in Ely`;
}

/**
 * A caller name with a number on the end ("Night Owl in Pahrump 4821"), for
 * when the plain names are all held. Still never longer than MAX_NAME_CHARS,
 * and drawn again until `accept` passes it: some numbers read as leetspeak
 * ("4554") to the name filter, which a generated name does not otherwise meet.
 */
export function numberedCallerName(rnd = randomInt, base = randomCallerName, accept = () => true) {
  for (let i = 0; i < 100; i++) {
    const name = `${base(rnd)} ${1000 + rnd(9000)}`;
    if (name.length <= MAX_NAME_CHARS && accept(name)) return name;
  }
  return "Caller 2626";
}

/** How two names are compared for uniqueness: case, accents and spacing do not make a name different. */
export function nameKey(name) {
  return String(name)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
