"use client";

import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { useFocusTrap } from "@/hooks/useFocusTrap";

/**
 * The phone lines on a phone: a bottom sheet that sits on top of whatever the
 * on-screen keyboard leaves.
 *
 * iOS does not shrink the layout viewport when the keyboard opens — it slides
 * the visual viewport over it — so a sheet sized in `vh` (or pinned to
 * `bottom: 0`) ends up with its input under the keyboard. This one is sized
 * from `visualViewport` and lifted by however much of the layout viewport the
 * keyboard covers, with `dvh` as the ceiling where the API is missing. The
 * chat itself (src/components/live/LiveChat.tsx) owns scrolling its own input
 * into view; this only guarantees there is a visible box to scroll in.
 */

interface ViewportBox {
  height: number;
  /** Layout-viewport pixels hidden below the visual viewport (the keyboard). */
  covered: number;
}

function readViewport(): ViewportBox | null {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return null;
  return {
    height: vv.height,
    covered: Math.max(0, window.innerHeight - vv.height - vv.offsetTop),
  };
}

export function useVisualViewportBox(active: boolean): ViewportBox | null {
  const [box, setBox] = useState<ViewportBox | null>(() => (active ? readViewport() : null));
  useEffect(() => {
    if (!active) return;
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setBox(readViewport());
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [active]);
  return box;
}

/** How much of the visible height the sheet takes. */
export const SHEET_FRACTION = 0.85;

export function LiveChatSheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const box = useVisualViewportBox(open);
  const { ref, onKeyDown } = useFocusTrap({ active: open, onEscape: onClose });
  if (!open) return null;
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-midnight/70 animate-glass-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Phone lines"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="live-chat-sheet"
        className={cn(
          "fixed inset-x-0 z-50 flex flex-col outline-none",
          "glass-light rounded-t-xl animate-glass-sheet",
          "pb-[var(--safe-bottom)] max-h-[85dvh]",
        )}
        style={{
          bottom: box ? box.covered : 0,
          height: box ? Math.round(box.height * SHEET_FRACTION) : "85dvh",
        }}
      >
        <div className="flex items-center justify-between px-4 pt-3 pb-2 flex-shrink-0">
          <span className="w98-font text-hd-caption uppercase tracking-[0.2em] text-desert-amber">
            Phone lines open
          </span>
          <button
            type="button"
            onClick={onClose}
            className="min-h-touch min-w-touch flex items-center justify-center text-hd-body text-bevel-dark active:text-desktop-gray cursor-pointer"
            aria-label="Close phone lines"
          >
            Close
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
      </div>
    </>
  );
}
