"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * The modal focus contract, in one place (HD-022).
 *
 * It lived inside `win98/Dialog.tsx`, and three other overlays grew their own
 * partial copies: the Command Palette had none at all (Tab walked out into the
 * page behind it, and its Escape reached the library's window handler, which
 * closed the detail panel as well), the mobile menu sheet listened for Escape
 * on `window` without stopping it, and the mobile detail and guest sheets had
 * no dialog role or focus handling. Every modal now takes it from here:
 *
 * - **On open**, remember what had focus and move focus inside — to
 *   `initialFocus` if given, else the first focusable element, else the
 *   container itself (give it `tabIndex={-1}`).
 * - **Tab / Shift+Tab** wrap at the ends and never leave the container. Focus
 *   that has somehow landed on the container itself goes to the first element.
 * - **Escape** calls `onEscape` and stops there: `stopPropagation()` keeps it
 *   from also reaching the window-level handlers behind the modal (the
 *   library's Escape dismisses the detail panel; the radio's navigates away).
 *   React's `stopPropagation` stops the native event too, so a listener on
 *   `window` never sees it.
 * - **On close** (or unmount), focus returns to where it was.
 *
 * Spread `onKeyDown` onto the element that `ref` points at.
 */

const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Tabbable elements inside `root`, in DOM order. Elements with no layout box
 * (`display: none` — a `hidden md:flex` control at the other width) are
 * skipped, since focusing them is a no-op and a trap whose "last" element is
 * invisible lets Tab escape. Where nothing has a box at all (jsdom, which has
 * no layout), the unfiltered list is the only information there is.
 */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  const laidOut = all.filter((el) => el.getClientRects().length > 0);
  return laidOut.length > 0 ? laidOut : all;
}

export interface FocusTrapOptions {
  /** Whether the modal is open. The trap arms and disarms with it. */
  active: boolean;
  /** Called on Escape. Omit to leave Escape alone. */
  onEscape?: () => void;
  /** Where focus goes on open, instead of the first focusable element. */
  initialFocus?: React.RefObject<HTMLElement | null>;
}

export function useFocusTrap<T extends HTMLElement = HTMLDivElement>({
  active,
  onEscape,
  initialFocus,
}: FocusTrapOptions) {
  const ref = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const raf = requestAnimationFrame(() => {
      const root = ref.current;
      if (!root) return;
      const target = initialFocus?.current ?? focusableIn(root)[0] ?? root;
      target.focus();
    });
    return () => {
      cancelAnimationFrame(raf);
      // Only hand focus back if it is still ours to give: a modal closed by
      // navigating elsewhere must not yank focus from where the user went.
      const current = document.activeElement;
      if (!current || current === document.body || node?.contains(current) || !current.isConnected) {
        previous?.focus();
      }
    };
    // initialFocus is a ref object; its identity is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const root = ref.current;
    if (!root) return;
    if (e.key === "Escape") {
      if (!onEscapeRef.current) return;
      e.stopPropagation();
      e.preventDefault();
      onEscapeRef.current();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = focusableIn(root);
    if (focusable.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const current = document.activeElement;
    if (e.shiftKey) {
      if (current === first || current === root || !root.contains(current)) {
        e.preventDefault();
        last.focus();
      }
    } else if (current === last || current === root || !root.contains(current)) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  return { ref, onKeyDown };
}
