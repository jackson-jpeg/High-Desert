"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { cn } from "@/lib/utils/cn";

export function ContextMenu() {
  const { open, position, items, hide } = useContextMenuStore();
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);

  // Get non-separator item indices
  const actionIndices = items
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => !item.separator)
    .map(({ i }) => i);

  // Reset focus when menu opens
  useEffect(() => {
    if (open) {
      setFocusedIdx(-1);
      // Focus first item
      requestAnimationFrame(() => {
        if (actionIndices.length > 0) {
          setFocusedIdx(actionIndices[0]);
        }
      });
    }
  }, [open]);

  // Adjust position if overflows viewport
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const menu = menuRef.current;
    const rect = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let { x, y } = position;
    if (x + rect.width > vw) x = vw - rect.width - 4;
    if (y + rect.height > vh) y = vh - rect.height - 4;
    if (x < 0) x = 4;
    if (y < 0) y = 4;

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
  }, [open, position]);

  // Close on click outside
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hide();
      }
    };

    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open, hide]);

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

  if (!open) return null;

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
