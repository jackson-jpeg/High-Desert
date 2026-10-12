"use client";

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { AccelLabel } from "./StartMenu";

export interface Win98MenuItem {
  label: string;
  onClick?: () => void;
  checked?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  testId?: string;
}

export interface Win98Menu {
  label: string;
  /** The underlined letter. */
  accel: string;
  items: Win98MenuItem[];
}

/**
 * A window's own menu bar (Notepad's File, Edit, Format, Help). Click or
 * Enter opens a menu; arrows move within it and Left/Right move between
 * menus; Escape closes and returns focus to the menu's title.
 */
export function Win98MenuBar({ menus, large = false }: { menus: Win98Menu[]; large?: boolean }) {
  const [open, setOpen] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const titles = useRef<(HTMLButtonElement | null)[]>([]);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const root = useRef<HTMLDivElement>(null);
  // The menus are rebuilt on every render of the window (a new call arrives);
  // focus moves only when a menu opens.
  const menusRef = useRef(menus);
  useEffect(() => {
    menusRef.current = menus;
  });

  useEffect(() => {
    if (open === null) return;
    const first = menusRef.current[open].items.findIndex((it) => !it.disabled);
    setActive(Math.max(0, first));
    const t = requestAnimationFrame(() => items.current[Math.max(0, first)]?.focus());
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => {
      cancelAnimationFrame(t);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const close = (focusTitle: boolean) => {
    const i = open;
    setOpen(null);
    if (focusTitle && i !== null) titles.current[i]?.focus();
  };

  const move = (dir: 1 | -1) => {
    if (open === null) return;
    const list = menus[open].items;
    let i = active;
    for (let step = 0; step < list.length; step++) {
      i = (i + dir + list.length) % list.length;
      if (!list[i].disabled) break;
    }
    setActive(i);
    items.current[i]?.focus();
  };

  const onMenuKey = (e: KeyboardEvent) => {
    if (open === null) return;
    const handled = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Escape", "Tab"];
    if (!handled.includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "ArrowDown") move(1);
    else if (e.key === "ArrowUp") move(-1);
    else if (e.key === "ArrowLeft") setOpen((open - 1 + menus.length) % menus.length);
    else if (e.key === "ArrowRight") setOpen((open + 1) % menus.length);
    else close(true);
  };

  return (
    <div ref={root} className="hd-w98-menubar flex items-center relative" role="menubar" onKeyDown={onMenuKey}>
      {menus.map((menu, m) => (
        <div key={menu.label} className="relative">
          <button
            ref={(el) => {
              titles.current[m] = el;
            }}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === m}
            data-testid={`notepad-menu-${menu.label.toLowerCase()}`}
            onClick={() => setOpen(open === m ? null : m)}
            className={cn(
              "hd-w98-menubar-title px-2 cursor-pointer",
              large ? "min-h-touch text-hd-body" : "py-[1px] text-hd-12",
              open === m && "hd-w98-menubar-title-open",
            )}
          >
            <AccelLabel label={menu.label} accel={menu.accel} />
          </button>
          {open === m && (
            <div role="menu" aria-label={menu.label} className="hd-w98-dropdown absolute left-0 top-full z-[70] min-w-[200px] py-[2px]">
              {menu.items.map((it, i) => (
                <Fragment key={it.label}>
                  {it.separatorBefore && <div role="separator" className="hd-w98-menu-sep" />}
                  <button
                    ref={(el) => {
                      items.current[i] = el;
                    }}
                    type="button"
                    role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
                    aria-checked={it.checked === undefined ? undefined : it.checked}
                    disabled={it.disabled}
                    tabIndex={i === active ? 0 : -1}
                    data-testid={it.testId}
                    onMouseEnter={() => {
                      if (!it.disabled) {
                        setActive(i);
                        items.current[i]?.focus();
                      }
                    }}
                    onClick={() => {
                      setOpen(null);
                      it.onClick?.();
                    }}
                    className={cn(
                      "hd-w98-menu-item w-full text-left flex items-center gap-2 whitespace-nowrap cursor-pointer",
                      large ? "min-h-touch px-3 text-hd-body" : "py-[3px] pl-1 pr-6 text-hd-12",
                      it.disabled && "hd-w98-menu-item-disabled",
                    )}
                  >
                    <span className="w-4 text-center flex-shrink-0" aria-hidden="true">
                      {it.checked ? "✓" : ""}
                    </span>
                    {it.label}
                  </button>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
