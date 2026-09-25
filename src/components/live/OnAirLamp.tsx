"use client";

import { cn } from "@/lib/utils/cn";

/**
 * The studio's ON AIR sign: a lamp that is lit while the station is
 * broadcasting and whose glow breathes while you are tuned in to it.
 *
 * A fill and a glow, not coloured text: the sign reads dark ink on the lit red
 * (5:1) and the secondary text tier on the unlit glass. The lamp sits in an
 * inset Win98 housing — the bevel's own box-shadow would swallow the glow, so
 * housing and lamp are two elements.
 */
export function OnAirLamp({
  lit,
  tuned = false,
  size = "md",
  className,
}: {
  /** The station has something on. */
  lit: boolean;
  /** This listener is tuned in. */
  tuned?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <span
      data-on-air={lit ? "lit" : "dark"}
      data-tuned={tuned ? "" : undefined}
      className={cn("w98-inset-dark inline-flex p-[2px] bg-inset-well", className)}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center select-none w98-font uppercase font-bold",
          size === "sm" && "px-1.5 py-0.5 text-hd-micro tracking-[0.18em]",
          size === "md" && "px-2.5 py-1 text-hd-caption tracking-[0.22em]",
          size === "lg" && "px-4 py-1.5 text-hd-title tracking-[0.28em]",
          lit
            ? "bg-on-air text-inset-well shadow-[0_0_12px_var(--hd-needle)]"
            : "bg-card-surface text-bevel-dark/85",
          lit && tuned && "animate-on-air-lamp",
        )}
      >
        On Air
      </span>
    </span>
  );
}
