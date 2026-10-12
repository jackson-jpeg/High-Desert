"use client";

import { useEffect, useId } from "react";
import { cn } from "@/lib/utils/cn";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";
import { LOOKS, LOOK_LABELS } from "@/lib/look/look";
import { LookPreview, LOOK_DESCRIPTIONS } from "./LookPreview";
import { useLookChoice } from "./useLookChoice";

/**
 * Night's Display setting: More > Display on a phone, View > Display... on the
 * desktop menu bar. The same choice as Win98's Display Properties
 * (./win98/DisplayProperties.tsx), drawn as a Night sheet: a bottom sheet on a
 * phone, a centred panel on a desktop. Apply sets the cookie and reloads.
 *
 * The two looks are native radio buttons (arrows move, a screen reader hears
 * the group), each a card with its thumbnail. Focus is trapped while open;
 * Escape and the backdrop close it.
 */
export function NightDisplay({ onClose }: { onClose: () => void }) {
  const { current, choice, setChoice, changed, apply } = useLookChoice();
  const name = useId();
  const titleId = useId();
  const { ref, onKeyDown } = useFocusTrap({ active: true, onEscape: onClose });

  useEffect(() => {
    lockScroll();
    return () => unlockScroll();
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-[110] glass-backdrop animate-glass-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        data-testid="night-display"
        className={cn(
          "fixed z-[111] glass-heavy text-desktop-gray outline-none",
          "inset-x-0 bottom-0 rounded-t-2xl pb-[calc(16px+var(--safe-bottom))] pl-[var(--safe-left)] pr-[var(--safe-right)] animate-glass-sheet",
          "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[440px] md:rounded-xl md:pb-4 md:animate-dialog",
        )}
      >
        <div className="px-4 pt-4 pb-2">
          <h2 id={titleId} className="text-hd-title font-bold">
            Display
          </h2>
          <p className="text-hd-body text-bevel-dark">The look of High Desert on this device.</p>
        </div>
        <fieldset className="px-4 grid grid-cols-2 gap-3">
          <legend className="sr-only">Look</legend>
          {LOOKS.map((look) => (
            <label
              key={look}
              className={cn(
                "flex flex-col gap-2 p-2 rounded-lg cursor-pointer border min-h-touch",
                choice === look ? "border-desert-amber bg-white/[0.06]" : "border-bevel-dark/40",
              )}
            >
              <LookPreview look={look} className="w-full aspect-[16/11] rounded" />
              <span className="flex items-center gap-2 text-hd-body">
                <input
                  type="radio"
                  name={name}
                  value={look}
                  checked={choice === look}
                  onChange={() => setChoice(look)}
                  className="accent-[var(--hd-amber)] w-4 h-4"
                  data-testid={`night-display-${look}`}
                />
                <span className="font-bold">{LOOK_LABELS[look]}</span>
                {look === current && <span className="text-hd-caption text-bevel-dark">current</span>}
              </span>
              <span className="text-hd-caption text-bevel-dark">{LOOK_DESCRIPTIONS[look]}</span>
            </label>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2 px-4 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="min-h-touch px-4 rounded-lg text-hd-body text-bevel-dark cursor-pointer active:bg-white/[0.06]"
            data-testid="night-display-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!changed}
            className="min-h-touch px-4 rounded-lg text-hd-body font-bold cursor-pointer bg-desert-amber text-midnight disabled:bg-white/[0.08] disabled:text-bevel-dark disabled:cursor-default"
            data-testid="night-display-apply"
          >
            Apply
          </button>
        </div>
      </div>
    </>
  );
}
