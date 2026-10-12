import { cn } from "@/lib/utils/cn";
import type { Look } from "@/lib/look/look";

/**
 * A thumbnail of a look, for the Display setting in either look: Win98's gray
 * window on the teal desktop, or Night's midnight with its gold and green.
 * Drawn from tokens neither look re-points (--hd-w98-*, --hd-void, --hd-edge,
 * --hd-navy), so each thumbnail reads the same whichever look it sits in.
 * Decorative: the choice's label says what it is.
 */
export function LookPreview({ look, className }: { look: Look; className?: string }) {
  if (look === "win98") {
    return (
      <div
        aria-hidden="true"
        data-look-preview="win98"
        className={cn("relative overflow-hidden bg-[var(--hd-w98-teal)]", className)}
      >
        <div className="absolute left-[14%] top-[16%] w-[64%] h-[56%] bg-[var(--hd-w98-face)] border border-[var(--hd-chrome-dark)]">
          <div className="h-[18%] bg-[var(--hd-navy)]" />
          <div className="m-[6%] h-[30%] bg-[var(--hd-chrome-lighter)] border border-[var(--hd-chrome-dark)]" />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-[13%] bg-[var(--hd-w98-face)] border-t border-[var(--hd-chrome-lighter)]" />
      </div>
    );
  }
  return (
    <div
      aria-hidden="true"
      data-look-preview="night"
      className={cn("relative overflow-hidden bg-[var(--hd-void)]", className)}
    >
      <div className="absolute left-[14%] top-[16%] w-[64%] h-[56%] bg-[var(--hd-edge)] rounded-[2px]">
        <div className="mx-[8%] mt-[10%] h-[10%] w-[50%] bg-[var(--hd-w98-amp-gold)]" />
        <div className="mx-[8%] mt-[8%] h-[8%] w-[70%] bg-[var(--hd-w98-amp-lcd)]" />
        <div className="mx-[8%] mt-[8%] h-[8%] w-[40%] bg-[var(--hd-w98-amp-text)]" />
      </div>
      <div className="absolute inset-x-0 bottom-0 h-[13%] bg-[var(--hd-w98-amp-shadow)]" />
    </div>
  );
}

/** Each look's one-line description, shared by both choosers. No em dashes (CLAUDE.md). */
export const LOOK_DESCRIPTIONS: Record<Look, string> = {
  win98: "Gray windows on a teal desktop. The classic.",
  night: "Dark, for listening late. Gold and green on midnight.",
};
