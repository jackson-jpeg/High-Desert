"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { useIsMobile } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils/cn";

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
  items: { label: string; onClick: () => void; disabled?: boolean; separator?: boolean; danger?: boolean }[];
  hide: () => void;
}) {
  // Close on backdrop click
  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50"
        onClick={hide}
      />
      {/* Sheet */}
      <div className="fixed bottom-0 inset-x-0 z-[101] bg-raised-surface w98-raised-dark pb-[var(--safe-bottom)] animate-slide-up">
        <div className="flex flex-col">
          {items.map((item, i) => {
            if (item.separator) {
              return (
                <div key={i} className="border-t border-bevel-dark/20" role="separator" />
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
                  "w-full text-left px-4 py-3 text-[14px] min-h-[48px] cursor-pointer",
                  "active:bg-title-bar-blue/20 transition-colors-fast",
                  item.disabled && "opacity-40 cursor-default",
                  item.danger ? "text-red-400" : "text-desktop-gray",
                )}
              >
                {item.label}
              </button>
            );
          })}
          {/* Cancel row */}
          <div className="border-t border-bevel-dark/20">
            <button
              onClick={hide}
              className="w-full text-center px-4 py-3 text-[14px] min-h-[48px] text-bevel-dark cursor-pointer active:bg-title-bar-blue/10"
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
  items: { label: string; onClick: () => void; disabled?: boolean; separator?: boolean; danger?: boolean }[];
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

  // Close on click outside
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hide();
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
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
              "w-full text-left px-3 py-1 text-[10px] cursor-pointer outline-none",
              "transition-colors-fast",
              isFocused && !item.disabled && "bg-title-bar-blue/20",
              !isFocused && "hover:bg-title-bar-blue/10",
              item.disabled && "opacity-40 cursor-default",
              item.danger ? "text-red-400" : "text-desktop-gray",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
