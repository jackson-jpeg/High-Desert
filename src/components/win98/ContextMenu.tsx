"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useContextMenuStore, type ContextMenuItem } from "@/stores/context-menu-store";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils/cn";
import { lockScroll, unlockScroll } from "@/lib/utils/scroll-lock";

export function ContextMenu() {
  const { open, position, items, hide } = useContextMenuStore();
  const isMobile = useIsMobile();

  if (!open) return null;

  if (isMobile) {
    return <MobileActionSheet items={items} hide={hide} />;
  }

  // Key on position to remount inner menu, resetting focus state
  return (
    <ContextMenuInner
      key={`${position.x}-${position.y}`}
      position={position}
      items={items}
      hide={hide}
    />
  );
}

/** Mobile: bottom action sheet */
function MobileActionSheet({
  items,
  hide,
}: {
  items: ContextMenuItem[];
  hide: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    lockScroll();
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Move focus into the sheet. Without this a screen-reader user's focus
    // stayed on the element behind it, with no indication the sheet had opened.
    requestAnimationFrame(() => {
      sheetRef.current?.querySelector<HTMLElement>("button:not([disabled])")?.focus();
    });

    return () => {
      unlockScroll();
      previousFocusRef.current?.focus();
    };
  }, []);

  // Escape to close + Tab trap, matching the desktop menu below.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        hide();
        return;
      }
      if (e.key !== "Tab" || !sheetRef.current) return;

      const focusable = Array.from(
        sheetRef.current.querySelectorAll<HTMLElement>("button:not([disabled])"),
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [hide],
  );

  // Close on backdrop click
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] glass-backdrop animate-glass-backdrop"
        aria-hidden="true"
        onClick={hide}
      />
      {/* Sheet */}
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Episode actions"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className="fixed bottom-0 inset-x-0 z-[101] glass-heavy rounded-t-2xl overflow-hidden pb-[var(--safe-bottom)] pl-[var(--safe-left)] pr-[var(--safe-right)] animate-glass-sheet"
      >
        {/* Grab handle */}
        <div className="flex justify-center pt-2.5 pb-1" aria-hidden="true">
          <div className="w-8 h-[3px] rounded-full bg-white/15" />
        </div>
        {/* The sheet itself is the modal; the item list is the menu. Nesting
            them this way keeps aria-modal on a role that supports it while
            still giving the menuitems a menu parent. */}
        <div className="flex flex-col" role="menu">
          {items.map((item, i) => {
            if (item.separator) {
              return (
                <div key={i} className="border-t glass-divider" role="separator" />
              );
            }
            return (
              <button
                key={i}
                onClick={() => {
                  if (!item.disabled) {
                    item.onClick();
                    hide();
                  }
                }}
                disabled={item.disabled}
                role="menuitem"
                className={cn(
                  "w-full text-left px-4 py-3 text-hd-14 min-h-[48px] cursor-pointer",
                  "active:bg-white/[0.06] transition-colors-fast",
                  item.disabled && "opacity-40 cursor-default",
                  item.danger ? "text-red-400" : "text-desktop-gray",
                )}
              >
                {item.checked ? "✓ " + item.label : item.label}
              </button>
            );
          })}
          {/* Cancel row */}
          <div className="border-t glass-divider" role="none">
            <button
              onClick={hide}
              role="menuitem"
              className="w-full text-center px-4 py-3 text-hd-14 min-h-[48px] text-bevel-dark cursor-pointer active:bg-white/[0.04]"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/** Desktop: positioned dropdown */
function ContextMenuInner({
  position,
  items,
  hide,
}: {
  position: { x: number; y: number };
  items: ContextMenuItem[];
  hide: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);

  // Get non-separator item indices
  const actionIndices = items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => !item.separator)
    .map(({ i }) => i);

  // Adjust position if overflows viewport + focus container
  useEffect(() => {
    if (!menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = position.x;
    let y = position.y;
    if (x + rect.width > vw) x = vw - rect.width - 4;
    if (y + rect.height > vh) y = vh - rect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    requestAnimationFrame(() => {
      menu.focus();
    });
  }, [position]);

  // Close on click outside or window resize
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hide();
      }
    };

    document.addEventListener("mousedown", handleClick);
    window.addEventListener("resize", hide);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("resize", hide);
    };
  }, [hide]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          e.stopPropagation();
          hide();
          break;
        case "ArrowDown": {
          e.preventDefault();
          const curPos = actionIndices.indexOf(focusedIdx);
          const next = curPos < actionIndices.length - 1 ? actionIndices[curPos + 1] : actionIndices[0];
          setFocusedIdx(next);
          break;
        }
        case "ArrowUp": {
          e.preventDefault();
          const curPos = actionIndices.indexOf(focusedIdx);
          const prev = curPos > 0 ? actionIndices[curPos - 1] : actionIndices[actionIndices.length - 1];
          setFocusedIdx(prev);
          break;
        }
        case "Home":
          e.preventDefault();
          if (actionIndices.length > 0) setFocusedIdx(actionIndices[0]);
          break;
        case "End":
          e.preventDefault();
          if (actionIndices.length > 0) setFocusedIdx(actionIndices[actionIndices.length - 1]);
          break;
        case "Enter":
        case " ": {
          e.preventDefault();
          const item = items[focusedIdx];
          if (item && !item.disabled && !item.separator) {
            item.onClick();
            hide();
          }
          break;
        }
      }
    },
    [focusedIdx, actionIndices, items, hide],
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] w98-dropdown-dark bg-raised-surface min-w-[160px] py-0.5 animate-fade-in outline-none"
      style={{ left: position.x, top: position.y }}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return (
            <div key={i} className="border-t border-bevel-dark/20 my-0.5" role="separator" />
          );
        }
        const isFocused = i === focusedIdx;
        return (
          <button
            key={i}
            ref={(el) => {
              if (isFocused && el) el.focus();
            }}
            onClick={() => {
              if (!item.disabled) {
                item.onClick();
                hide();
              }
            }}
            onMouseEnter={() => setFocusedIdx(i)}
            disabled={item.disabled}
            role="menuitem"
            tabIndex={isFocused ? 0 : -1}
            className={cn(
              "w-full text-left px-3 py-1 text-hd-10 cursor-pointer outline-none",
              "transition-colors-fast",
              isFocused && !item.disabled && "bg-title-bar-blue/20",
              !isFocused && "hover:bg-title-bar-blue/10",
              item.disabled && "opacity-40 cursor-default",
              item.danger ? "text-red-400" : "text-desktop-gray",
            )}
          >
            {item.checked ? "✓ " + item.label : item.label}
          </button>
        );
      })}
    </div>
  );
}
