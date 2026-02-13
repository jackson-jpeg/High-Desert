"use client";

import { useEffect, useRef } from "react";
import { useContextMenuStore } from "@/stores/context-menu-store";
import { cn } from "@/lib/utils/cn";

export function ContextMenu() {
  const { open, position, items, hide } = useContextMenuStore();
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close on click outside or Escape
  useEffect(() => {
    if (!open) return;

    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        hide();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") hide();
    };

    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, hide]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-[100] w98-dropdown-dark bg-raised-surface min-w-[160px] py-0.5 animate-fade-in"
      style={{ left: position.x, top: position.y }}
    >
      {items.map((item, i) => {
        if (item.separator) {
          return (
            <div key={i} className="border-t border-bevel-dark/20 my-0.5" />
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
            className={cn(
              "w-full text-left px-3 py-1 text-[10px] cursor-pointer",
              "hover:bg-title-bar-blue/20 transition-colors-fast",
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
