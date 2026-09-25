/**
 * The station ID: the short gap between two shows on the live station, filled
 * with the radio dial's own AM static (src/audio/radio-static.ts) and closed
 * with its lock tone as the next show comes in.
 *
 * Volume-matched: the static is scaled by the player's volume, so a listener
 * with the show turned down is not hit by a burst at full level between shows.
 *
 * The static's AudioContext must be created inside a user gesture, so
 * `prepareStationId()` is called from the tune-in tap; the IDs themselves fire
 * from timers hours later. If this module created the context it also tears it
 * down when the listener leaves the station — the looping noise source runs
 * (silently) for as long as the context lives, and on a phone that is battery.
 * A context the radio dial made is the dial's, and left alone.
 */

import {
  destroyRadioStatic,
  initRadioStatic,
  isRadioStaticInitialized,
  muteStatic,
  playLockTone,
  setStaticVolume,
} from "./radio-static";

let ours = false;
let on = false;

/** From a gesture: make sure the static can sound later. */
export function prepareStationId(): void {
  if (isRadioStaticInitialized()) return;
  initRadioStatic();
  ours = isRadioStaticInitialized();
  muteStatic();
}

/** Between shows: static at the player's volume (0–1). */
export function startStationId(playerVolume: number): void {
  if (!isRadioStaticInitialized()) return; // no context from a gesture: a silent gap
  on = true;
  const v = Math.max(0, Math.min(1, playerVolume));
  // setStaticVolume takes a *signal strength*: 0 is full static (15%), 1 silence.
  setStaticVolume(1 - v);
}

/** The next show is locking in: static out, lock tone. */
export function stopStationId(): void {
  if (!on) return;
  on = false;
  muteStatic();
  playLockTone();
}

/** The listener left the station. */
export function releaseStationId(): void {
  if (on) {
    on = false;
    muteStatic();
  }
  if (ours) {
    ours = false;
    destroyRadioStatic();
  }
}

export function isStationIdOn(): boolean {
  return on;
}
