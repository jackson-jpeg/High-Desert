"use client";

import { useSyncExternalStore } from "react";
import { useStationClock } from "@/hooks/useLiveStation";

/** Hours and minutes left until `closesAt`, rounded up; null once it has passed. */
export function untilClose(closesAt: number, now: number): { h: number; m: number } | null {
  const left = closesAt - now;
  if (left <= 0) return null;
  const minutes = Math.ceil(left / 60_000);
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

const noop = () => () => {};

/**
 * The countdown to 6 PM Pacific on the request board as a flip clock
 * (docs/UI-PLAN.md, push 4). Cards turn once a minute, without animation; the
 * server renders blank cards so the first paint never disagrees with the
 * browser's clock.
 */
export function FlipClock({ closesAt }: { closesAt: number }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const now = useStationClock(15_000);
  const left = mounted ? untilClose(closesAt, now) : undefined;
  const pad = (n: number) => String(n).padStart(2, "0");
  const digits = left ? `${pad(Math.min(left.h, 99))}${pad(left.m)}` : "----";
  const label = left === undefined ? "Time left to vote" : left ? `${left.h} hours ${left.m} minutes left to vote` : "Voting is closed";
  return (
    <div className="hd-flip-clock" role="timer" aria-label={label} data-flip-clock={left === null ? "closed" : ""}>
      <span className="hd-flip-clock-cards" aria-hidden="true">
        <span className="hd-flip-card">{digits[0]}</span>
        <span className="hd-flip-card">{digits[1]}</span>
        <span className="hd-flip-colon">:</span>
        <span className="hd-flip-card">{digits[2]}</span>
        <span className="hd-flip-card">{digits[3]}</span>
      </span>
      <span className="hd-flip-clock-label">{left === null ? "Voting closed" : "to vote"}</span>
    </div>
  );
}
