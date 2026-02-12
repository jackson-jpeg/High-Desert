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
}

export function MenuBar({ menus, variant = "classic", className }: MenuBarProps) {
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

  return (
    <div
      ref={barRef}
      className={cn(
        isDark ? "w98-menubar-dark" : "w98-menubar",
        "flex items-center relative",
        className,
      )}
    >
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
            <div className={cn(
              isDark ? "w98-dropdown-dark" : "w98-dropdown",
              "animate-fade-in",
            )}>
              {menu.items.map((item, j) =>
                item.separator ? (
                  <div key={`sep-${j}`} className={isDark ? "w98-dropdown-separator-dark" : "w98-dropdown-separator"} />
                ) : (
                  <button
                    key={item.label}
                    className={cn(
                      "w98-dropdown-item w98-font block w-full text-left",
                      item.disabled && "text-[var(--w98-text-disabled)]",
                    )}
                    disabled={item.disabled}
                    onClick={() => {
                      item.onClick?.();
                      setOpenIndex(null);
                    }}
                  >
                    <span className="flex justify-between gap-4">
                      <span>{item.label}</span>
                      {item.shortcut && (
                        <span className="text-bevel-dark">
                          {item.shortcut}
                        </span>
                      )}
                    </span>
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
