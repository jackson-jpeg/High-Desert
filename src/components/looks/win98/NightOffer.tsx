"use client";

import { useEffect, useId, useState } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { useLook } from "@/hooks/useLook";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useLiveStore } from "@/stores/live-store";
import { chooseLook, dismissNightOffer, markNightOffered, shouldOfferNight } from "@/lib/look/choice";
import { Win98Icon } from "./Win98Icon";

/** How often the offer looks for the boot screen to have gone. */
export const BOOT_POLL_MS = 250;

/** The boot screen (#app-loading, src/app/boot-script.ts) is gone or fading. */
export function bootScreenGone(doc: Document = document): boolean {
  const el = doc.getElementById("app-loading");
  return !el || el.style.display === "none" || el.style.opacity === "0";
}

/**
 * Whether the offer must wait where it is: on a phone's Live screen, until the
 * listener has tuned in. That screen's first job is one Listen tap
 * (docs/funnel.md), and nothing may sit over it.
 */
export function offerHeldBack(isMobile: boolean, pathname: string | null, tuned: boolean): boolean {
  return isMobile && pathname === "/live" && !tuned;
}

/**
 * The one-time "Prefer dark? Switch to Night" offer (docs/looks.md). Win98 is
 * the default; a browser that has never chosen a look and never been offered
 * sees this once: a small balloon above the bottom bar, after the boot screen,
 * never over the Live screen's Listen tap on a phone. Accepting switches to
 * Night (cookie, reload); dismissing, or simply seeing it, means it never
 * shows again (`hd-look-offer`, written before it shows).
 *
 * Client only, after hydration, and only inside the app shell: show and guest
 * pages, and every crawler's first paint, never have it.
 */
export function NightOffer({ bottomPx }: { bottomPx: number }) {
  const look = useLook();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const tuned = useLiveStore((s) => s.tuned);
  const [eligible, setEligible] = useState(false);
  const [bootGone, setBootGone] = useState(false);
  const [phase, setPhase] = useState<"waiting" | "shown" | "gone">("waiting");
  const textId = useId();

  useEffect(() => {
    setEligible(shouldOfferNight(look, document.cookie));
  }, [look]);

  useEffect(() => {
    if (!eligible || bootGone) return;
    if (bootScreenGone()) {
      setBootGone(true);
      return;
    }
    const id = setInterval(() => {
      if (bootScreenGone()) setBootGone(true);
    }, BOOT_POLL_MS);
    return () => clearInterval(id);
  }, [eligible, bootGone]);

  const held = offerHeldBack(isMobile, pathname, tuned);
  useEffect(() => {
    if (phase !== "waiting" || !eligible || !bootGone || held) return;
    // Written before it shows: a browser that cannot remember would see it on every load.
    setPhase(markNightOffered() ? "shown" : "gone");
  }, [phase, eligible, bootGone, held]);

  if (phase !== "shown") return null;

  const dismiss = () => {
    dismissNightOffer();
    setPhase("gone");
  };

  return (
    <div
      role="region"
      aria-labelledby={textId}
      data-testid="night-offer"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          dismiss();
        }
      }}
      className={cn(
        "hd-w98-offer fixed z-[45] flex items-center gap-2 w98-font",
        isMobile ? "left-2 right-2 px-2 py-1" : "right-3 max-w-[340px] px-2 py-[3px]",
      )}
      style={{ bottom: `calc(${bottomPx + (isMobile ? 6 : 34)}px + var(--safe-bottom, 0px))` }}
    >
      <Win98Icon name="display" size={16} className="flex-shrink-0" />
      <p id={textId} className="text-hd-12 flex-1 min-w-0">
        Prefer dark?
      </p>
      <button
        type="button"
        onClick={() => chooseLook("night")}
        data-testid="night-offer-accept"
        className="hd-w98-offer-button text-hd-12 px-2 min-h-touch md:min-h-[24px] cursor-pointer flex-shrink-0"
      >
        Switch to Night
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="No thanks"
        title="No thanks"
        data-testid="night-offer-dismiss"
        className="hd-w98-offer-close text-hd-12 min-w-touch min-h-touch md:min-w-[24px] md:min-h-[24px] flex items-center justify-center cursor-pointer flex-shrink-0"
      >
        <span aria-hidden="true">{"✕"}</span>
      </button>
    </div>
  );
}
