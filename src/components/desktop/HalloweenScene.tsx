"use client";

import { useSeason } from "@/hooks/useSeason";
import { moonSprite, pumpkinSprite } from "@/lib/season/pixel-art";
import { PixelSprite } from "./PixelSprite";

const MOON = moonSprite();
const PUMPKIN = pumpkinSprite();

/**
 * Halloween's scene (docs/seasons.md): a harvest moon with bats against it
 * and a jack-o'-lantern, pixel art in the 90s way. Nothing moves or blinks
 * (the flying bats were distracting, and flapping near 3 a second is close
 * to the line for photosensitivity). It sits on the desktop, behind every
 * window, so it shows wherever Win98's desktop is open: the welcome screen
 * and the margins of Live and Stats. Night shows none (its glass covers the
 * sky); its pumpkin is in the status bar's badge (seasons.css).
 */
export function HalloweenScene() {
  if (useSeason() !== "halloween") return null;
  return (
    <div className="hd-halloween" aria-hidden="true" data-halloween-scene="">
      <PixelSprite sprite={MOON} className="hd-halloween-moon" data-halloween-part="moon" />
      <PixelSprite sprite={PUMPKIN} className="hd-halloween-pumpkin" data-halloween-part="pumpkin" />
    </div>
  );
}
