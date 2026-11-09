"use client";

import { useEffect, useState } from "react";
import { serverNow } from "@/stores/live-store";
import { SPONSORS } from "@/lib/support/sponsors";
import { setBreaksMuted } from "@/lib/live/breaks-pref";
import type { StationBreak } from "@/lib/live/breaks";
import { noteSponsor } from "@/services/stats/sponsor-client";
import { SponsorAd } from "./SponsorAd";

export const BREAK_OPEN = "*** The station is going to a break ***";
export const BREAK_CLOSE = "*** Back to the show ***";

function mmss(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Seconds into the spot on the station's clock, held to 0…duration. */
export function breakElapsedSec(b: Pick<StationBreak, "start" | "durationSec">, nowMs: number): number {
  return Math.min(b.durationSec, Math.max(0, (nowMs - b.start) / 1000));
}

/**
 * A station break in the phone lines (docs/station-breaks.md), for both looks:
 * the open marker, a window "On air: station break" with its lamp and cart
 * label, the cart machine's LCD keeping time with the spot on the station's
 * clock, the print ad, Mute breaks, and the close marker once the spot is
 * over. Drawn for every caller at the break's time, tuned in or not.
 */
export function StationBreakCard({ b, now: nowProp }: { b: StationBreak; now?: number }) {
  const [now, setNow] = useState(() => nowProp ?? serverNow());
  const t = nowProp ?? now;
  const playing = t >= b.start && t < b.end;
  const elapsed = breakElapsedSec(b, t);
  const sponsor = SPONSORS[b.spot];

  useEffect(() => {
    if (nowProp !== undefined) return;
    if (serverNow() >= b.end) return;
    const id = setInterval(() => {
      const n = serverNow();
      setNow(n);
      if (n >= b.end) clearInterval(id);
    }, 250);
    return () => clearInterval(id);
  }, [b.end, nowProp]);

  useEffect(() => {
    noteSponsor(b.spot, "chat", "seen", b.id);
  }, [b.spot, b.id]);

  if (!sponsor) return null;
  const pct = Math.round((elapsed / b.durationSec) * 100);
  return (
    <li className="hd-break" data-testid="station-break" data-break={b.id} data-app={b.spot} data-playing={playing ? "true" : "false"}>
      <p className="hd-break-marker" data-testid="break-open">
        {BREAK_OPEN}
      </p>
      <section className="hd-break-window" aria-label={`Station break: ${sponsor.name}`}>
        <header className="hd-break-title">
          <span className={playing ? "hd-break-lamp hd-break-lamp-on" : "hd-break-lamp"} aria-hidden="true" data-testid="break-lamp" />
          <span className="hd-break-title-text">On air: station break</span>
          <span className="hd-break-cart" data-testid="break-cart">
            Cart {b.cart}
          </span>
        </header>
        <div
          className="hd-break-lcd"
          role="progressbar"
          aria-label="Spot playing"
          aria-valuemin={0}
          aria-valuemax={Math.round(b.durationSec)}
          aria-valuenow={Math.round(elapsed)}
          data-testid="break-lcd"
        >
          <span className="hd-break-lcd-label">
            {`CART ${b.cart}  ${sponsor.name.toUpperCase()}`}
          </span>
          <span className="hd-break-lcd-bar">
            <span className="hd-break-lcd-fill" style={{ width: `${pct}%` }} data-testid="break-lcd-fill" />
          </span>
          <span className="hd-break-lcd-time" data-testid="break-lcd-time">
            {`${mmss(elapsed)} / ${mmss(b.durationSec)}`}
          </span>
        </div>
        <SponsorAd id={b.spot} surface="chat" flying={playing} durationSec={b.durationSec} elapsedSec={elapsed} />
        <button
          type="button"
          className="hd-break-mute"
          data-testid="break-mute"
          onClick={() => {
            noteSponsor(b.spot, "chat", "mute");
            setBreaksMuted(true);
          }}
        >
          Mute breaks
        </button>
      </section>
      {t >= b.end && (
        <p className="hd-break-marker" data-testid="break-close">
          {BREAK_CLOSE}
        </p>
      )}
    </li>
  );
}
