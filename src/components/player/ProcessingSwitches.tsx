"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { setCleanupSwitch, setLevelSwitch } from "@/audio/processing";
import { UNAVAILABLE_REASON, switchesUsable, useProcessingStore } from "@/stores/processing-store";

/**
 * Level and Clean up, the listener's two switches (docs/audio-processing/README.md).
 *
 * One component for both looks and every player size. It only reads the
 * processing store and calls setLevelSwitch / setCleanupSwitch: the audio
 * graph (src/audio/processing.ts) does the rest, so a switch here can never
 * be out of step with what the listener hears.
 *
 *   layout="rows"   each switch with its one-line explanation under or beside it
 *                   (the phone players, Night's expanded player)
 *   layout="strip"  the switches in a row and one line of text that explains
 *                   the one under the pointer or focus, as Winamp's own
 *                   readout named the button under the mouse
 *
 * When this device cannot run them (iPhone, an old browser, a failure) the
 * switches are greyed and the reason is the line. They stay visible, so the
 * listener knows the feature exists and why it is off.
 *
 * While Clean up is held back (CLEANUP_RELEASED in the store) only Level is
 * drawn; the hidden switch appears with the preview key.
 *
 * Copy is user-facing: no em dashes (src/components/player/__tests__/processing-switches.test.tsx).
 */

export const LEVEL_EXPLAINER = "Evens out quiet guests and loud callers.";
export const CLEANUP_EXPLAINER = "Takes out hiss and hum.";
export const STRIP_DEFAULT = "Level evens out voices. Clean up takes out hiss and hum.";
/** The strip's line while Clean up is held back (CLEANUP_RELEASED). */
export const STRIP_LEVEL_ONLY = "Level evens out quiet guests and loud callers.";

type Which = "level" | "cleanup";

export function ProcessingSwitches({
  look,
  layout,
  className,
}: {
  look: "win98" | "night";
  layout: "rows" | "strip";
  className?: string;
}) {
  const level = useProcessingStore((s) => s.level);
  const cleanup = useProcessingStore((s) => s.cleanup);
  const availability = useProcessingStore((s) => s.availability);
  const offered = useProcessingStore((s) => s.cleanupOffered);
  // Where Level's gain comes from right now, for the browser tests and a
  // check on production: "envelope" (two-pass) or "live" (no envelope yet).
  const levelSource = useProcessingStore((s) => s.meter?.levelSource ?? null);
  const [hover, setHover] = useState<Which | null>(null);
  const id = useId();
  const usable = switchesUsable(availability);
  const reason = usable ? null : UNAVAILABLE_REASON[availability as keyof typeof UNAVAILABLE_REASON];

  const sw = (which: Which) => {
    const on = which === "level" ? level : cleanup;
    const label = which === "level" ? "Level" : "Clean up";
    const explainer = which === "level" ? LEVEL_EXPLAINER : CLEANUP_EXPLAINER;
    const descId = `${id}-${which}`;
    const button = (
      <button
        type="button"
        role="switch"
        aria-checked={usable ? on : false}
        aria-disabled={!usable || undefined}
        aria-describedby={layout === "rows" ? descId : `${id}-line`}
        title={reason ?? explainer}
        data-testid={`dsp-${which}`}
        data-on={usable && on ? "true" : "false"}
        className={cn("hd-dsp-switch", usable && on && "hd-dsp-switch-on", !usable && "hd-dsp-switch-off")}
        onClick={() => {
          if (!usable) return;
          if (which === "level") setLevelSwitch(!level);
          else setCleanupSwitch(!cleanup);
        }}
        onPointerEnter={() => setHover(which)}
        onPointerLeave={() => setHover((h) => (h === which ? null : h))}
        onFocus={() => setHover(which)}
        onBlur={() => setHover((h) => (h === which ? null : h))}
      >
        <span className="hd-dsp-led" aria-hidden="true" />
        <span className="hd-dsp-label">{look === "win98" ? label.toUpperCase() : label}</span>
      </button>
    );
    if (layout === "strip") return <span key={which}>{button}</span>;
    return (
      <div key={which} className="hd-dsp-row">
        {button}
        <span id={descId} className="hd-dsp-explainer">
          {explainer}
        </span>
      </div>
    );
  };

  const line = reason ?? (hover === "level" ? LEVEL_EXPLAINER : hover === "cleanup" ? CLEANUP_EXPLAINER : offered ? STRIP_DEFAULT : STRIP_LEVEL_ONLY);

  return (
    <div
      role="group"
      aria-label="Sound"
      className={cn("hd-dsp", `hd-dsp-${look}`, `hd-dsp-${layout}`, className)}
      data-testid="dsp-switches"
      data-availability={availability}
      data-level-source={levelSource ?? undefined}
    >
      {layout === "strip" && (
        <span className="hd-dsp-title" aria-hidden="true">
          {look === "win98" ? "DSP" : "Sound"}
        </span>
      )}
      {sw("level")}
      {offered && sw("cleanup")}
      {layout === "strip" ? (
        <span id={`${id}-line`} className="hd-dsp-line" data-testid="dsp-line">
          {line}
        </span>
      ) : (
        reason && (
          <span className="hd-dsp-reason" data-testid="dsp-reason" role="status">
            {reason}
          </span>
        )
      )}
    </div>
  );
}
