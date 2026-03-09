"use client";

import { cn } from "@/lib/utils/cn";
import { useCallback, useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export interface Menu {
  label: string;
  items: MenuItem[];
}

export interface MenuBarProps {
  menus: Menu[];
  variant?: "classic" | "dark";
  className?: string;
  /** Optional title shown before menu items (clickable). */
  title?: string;
  onTitleClick?: () => void;
}

function DropdownMenu({
  items,
  isDark,
  onSelect,
}: {
  items: MenuItem[];
  isDark: boolean;
  onSelect: () => void;
}) {
  const [focused, setFocused] = useState(-1);
  const menuRef = useRef<HTMLDivElement>(null);
  const actionItems = items.map((item, i) => ({ item, i })).filter(({ item }) => !item.separator && !item.disabled);

  useEffect(() => {
    menuRef.current?.focus();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const curActionIdx = actionItems.findIndex(({ i }) => i === focused);
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        e.stopPropagation();
        const next = curActionIdx < actionItems.length - 1 ? actionItems[curActionIdx + 1].i : actionItems[0].i;
        setFocused(next);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        e.stopPropagation();
        const prev = curActionIdx > 0 ? actionItems[curActionIdx - 1].i : actionItems[actionItems.length - 1].i;
        setFocused(prev);
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        const item = items[focused];
        if (item && !item.disabled && !item.separator) {
          item.onClick?.();
          onSelect();
        }
        break;
      }
    }
  };

  return (
    <div
      ref={menuRef}
      className={cn(isDark ? "w98-dropdown-dark" : "w98-dropdown", "animate-fade-in outline-none")}
      role="menu"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {items.map((item, j) =>
        item.separator ? (
          <div key={`sep-${j}`} className={isDark ? "w98-dropdown-separator-dark" : "w98-dropdown-separator"} role="separator" />
        ) : (
          <button
            key={item.label}
            className={cn(
              "w98-dropdown-item w98-font block w-full text-left",
              item.disabled && "text-[var(--w98-text-disabled)]",
              j === focused && !item.disabled && "bg-[var(--w98-highlight)] text-white",
            )}
            disabled={item.disabled}
            role="menuitem"
            onMouseEnter={() => setFocused(j)}
            onClick={() => {
              item.onClick?.();
              onSelect();
            }}
          >
            <span className="flex justify-between gap-4">
              <span>{item.label}</span>
              {item.shortcut && (
                <span className={cn(j === focused ? "text-white/60" : "text-bevel-dark")}>
                  {item.shortcut}
                </span>
              )}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

export function MenuBar({ menus, variant = "classic", className, title, onTitleClick }: MenuBarProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const isDark = variant === "dark";

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (barRef.current && !barRef.current.contains(e.target as Node)) {
      setOpenIndex(null);
    }
  }, []);

  useEffect(() => {
    if (openIndex !== null) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [openIndex, handleClickOutside]);

  // Keyboard navigation when a menu is open
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (openIndex === null) return;

    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        setOpenIndex((openIndex + 1) % menus.length);
        break;
      case "ArrowLeft":
        e.preventDefault();
        setOpenIndex((openIndex - 1 + menus.length) % menus.length);
        break;
      case "Escape":
        e.preventDefault();
        setOpenIndex(null);
        break;
    }
  }, [openIndex, menus.length]);

  return (
    <div
      ref={barRef}
      className={cn(
        isDark ? "w98-menubar-dark" : "w98-menubar",
        "flex items-center relative",
        className,
      )}
      role="menubar"
      aria-label="Application menu"
      onKeyDown={handleKeyDown}
    >
      {title && (
        <button
          className="w98-menubar-item w98-font text-desert-amber/80 cursor-pointer select-none"
          onClick={onTitleClick}
        >
          {title}
        </button>
      )}
      {menus.map((menu, i) => (
        <div key={menu.label} className="relative">
          <button
            className={cn(
              "w98-menubar-item w98-font",
              openIndex === i && "bg-[var(--w98-highlight)] text-white",
            )}
            data-open={openIndex === i}
            onClick={() => setOpenIndex(openIndex === i ? null : i)}
            onMouseEnter={() => openIndex !== null && setOpenIndex(i)}
          >
            {menu.label}
          </button>
          {openIndex === i && (
            <DropdownMenu
              items={menu.items}
              isDark={isDark}
              onSelect={() => setOpenIndex(null)}
            />
          )}
        </div>
      ))}
    </div>
  );
}
