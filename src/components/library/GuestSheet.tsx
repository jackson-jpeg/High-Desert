"use client";

import type { Episode } from "@/db/schema";
import { GuestProfile } from "@/components/library/GuestProfile";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { cn } from "@/lib/utils/cn";

/**
 * The guest profile panel: a slide-up sheet on a phone, a 280px sidebar on
 * desktop. Moved out of `library/page.tsx` so the phone sheet could become a
 * real modal dialog (HD-022) — it had no role and no focus handling, so a
 * screen-reader user was left on the list behind it. On desktop it sits
 * beside the list and is not modal.
 */
export function GuestSheet({
  guestName,
  onPlay,
  onClose,
}: {
  guestName: string;
  onPlay: (episode: Episode) => void;
  onClose: () => void;
}) {
  const isMobile = useIsMobile();
  const { ref, onKeyDown } = useFocusTrap({ active: isMobile, onEscape: onClose });

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 z-40 md:hidden animate-glass-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={ref}
        {...(isMobile
          ? { role: "dialog", "aria-modal": true, "aria-label": `Guest profile: ${guestName}`, tabIndex: -1, onKeyDown }
          : {})}
        className={cn(
          "fixed bottom-0 inset-x-0 z-50 max-h-[80dvh] overflow-auto pb-[var(--safe-bottom)] animate-glass-sheet rounded-t-xl outline-none",
          "md:relative md:bottom-auto md:inset-x-auto md:w-[280px] md:flex-shrink-0 md:h-full md:max-h-none md:overflow-auto md:pb-0 md:z-auto md:border-l md:border-bevel-dark/20 md:animate-fade-in md:rounded-none",
        )}
      >
        <GuestProfile guestName={guestName} onPlay={onPlay} onClose={onClose} />
      </div>
    </>
  );
}
