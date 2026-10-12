"use client";

import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { startMenuKey, submenuOf, type StartItem } from "./start-menu";
import { Win98Icon } from "./Win98Icon";

/** The label with its accelerator letter underlined, as Windows drew it. */
export function AccelLabel({ label, accel }: { label: string; accel: string }) {
  const i = label.toLowerCase().indexOf(accel.toLowerCase());
  if (i < 0) return <>{label}</>;
  return (
    <>
      {label.slice(0, i)}
      <span className="underline underline-offset-2">{label[i]}</span>
      {label.slice(i + 1)}
    </>
  );
}

/**
 * The Start menu: the "High Desert 98" band down the left and the programs.
 * Focus moves into it when it opens; arrows, Home, End and an item's
 * underlined letter move or pick; Escape and Tab close it and give focus
 * back to the Start button (the Taskbar does that through onClose).
 *
 * An item with a submenu (Settings) opens it on a click, Enter, Right arrow,
 * its letter, or hovering it; the submenu takes focus, and Left arrow or
 * Escape closes it and gives focus back to its item.
 */
export function StartMenu({
  items,
  onPick,
  onClose,
  large = false,
}: {
  items: StartItem[];
  /** An item that acts (never one that opens a submenu). */
  onPick: (item: StartItem) => void;
  onClose: (opts: { restoreFocus: boolean }) => void;
  /** Phone: 44 px rows. */
  large?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);
  const [openSub, setOpenSub] = useState<number | null>(null);
  // Where the open submenu sits, measured from its item: the menu scrolls
  // (overflow: auto), so the submenu is drawn beside it, not inside it.
  const [subPos, setSubPos] = useState({ top: 0, bottom: 0 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const subId = useId();

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const focusItem = (i: number) => {
    setActive(i);
    refs.current[i]?.focus();
  };

  const openSubAt = (i: number) => {
    const b = refs.current[i]?.getBoundingClientRect();
    const w = wrapRef.current?.getBoundingClientRect();
    if (b && w) setSubPos({ top: b.top - w.top, bottom: w.bottom - b.top });
    setOpenSub(i);
  };

  const choose = (i: number) => {
    if (submenuOf(items[i])) {
      setActive(i);
      openSubAt(i);
    } else {
      onPick(items[i]);
    }
  };

  const closeSub = () => {
    const i = openSub;
    setOpenSub(null);
    if (i !== null) focusItem(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // The menu owns its keys: nothing behind it (the library's arrows and
    // Escape, the player's letters) may act on them too.
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose({ restoreFocus: true });
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      e.stopPropagation();
      onClose({ restoreFocus: true });
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "ArrowRight" && submenuOf(items[active])) {
      e.preventDefault();
      e.stopPropagation();
      choose(active);
      return;
    }
    const next = startMenuKey(e.key, active, items);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (openSub !== null) setOpenSub(null);
    if (e.key.length === 1) choose(next);
    else focusItem(next);
  };

  const subItems = openSub !== null ? submenuOf(items[openSub]) : null;

  return (
    <div ref={wrapRef} className="relative">
      <div
        role="menu"
        aria-label="Start"
        data-testid="w98-start-menu"
        onKeyDown={onKeyDown}
        className={cn("hd-w98-start-menu w98-raised-dark bg-raised-surface flex", large && "hd-w98-start-menu-large")}
      >
        <div className="hd-w98-start-band" aria-hidden="true">
          <span>
            <b>High Desert</b>98
          </span>
        </div>
        <ul role="none" className="flex flex-col py-[2px] min-w-0 flex-1">
          {items.map((item, i) => {
            const sub = submenuOf(item);
            return (
              <Fragment key={item.id}>
                {item.separatorBefore && <li role="separator" className="hd-w98-menu-sep" />}
                <li role="none">
                  <button
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    aria-haspopup={sub ? "menu" : undefined}
                    aria-expanded={sub ? openSub === i : undefined}
                    aria-controls={sub && openSub === i ? subId : undefined}
                    tabIndex={i === active ? 0 : -1}
                    data-testid={`w98-start-${item.id}`}
                    onFocus={() => setActive(i)}
                    onMouseEnter={() => {
                      focusItem(i);
                      // Hovering opens a submenu, and leaving for another item closes it, as Windows does.
                      if (large) return;
                      if (sub) openSubAt(i);
                      else setOpenSub(null);
                    }}
                    onClick={() => choose(i)}
                    className={cn(
                      "hd-w98-menu-item w-full flex items-center gap-2 text-left cursor-pointer w98-font",
                      large ? "min-h-touch px-3 text-hd-body" : "px-2 py-[5px] text-hd-12",
                      sub && openSub === i && "hd-w98-menu-item-open",
                    )}
                  >
                    <Win98Icon name={item.icon} size={large ? 24 : 20} className="flex-shrink-0" />
                    <span className="truncate flex-1">
                      <AccelLabel label={item.label} accel={item.accel} />
                    </span>
                    {sub && (
                      <span aria-hidden="true" className="flex-shrink-0">
                        {"\u25B8"}
                      </span>
                    )}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ul>
      </div>
      {openSub !== null && subItems && (
        <SubMenu
          id={subId}
          label={items[openSub].label}
          items={subItems}
          large={large}
          style={large ? { bottom: subPos.bottom } : { top: subPos.top }}
          onPick={onPick}
          onBack={closeSub}
          onCloseAll={() => onClose({ restoreFocus: true })}
        />
      )}
    </div>
  );
}

/** A cascading submenu (Start > Settings). It owns its keys; nothing reaches the menu behind it. */
function SubMenu({
  id,
  label,
  items,
  large,
  style,
  onPick,
  onBack,
  onCloseAll,
}: {
  id: string;
  label: string;
  items: StartItem[];
  large: boolean;
  style: CSSProperties;
  onPick: (item: StartItem) => void;
  onBack: () => void;
  onCloseAll: () => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  const focusItem = (i: number) => {
    setActive(i);
    refs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.key === "Escape" || e.key === "ArrowLeft") {
      e.preventDefault();
      onBack();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      onCloseAll();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const next = startMenuKey(e.key, active, items);
    if (next === null) return;
    e.preventDefault();
    if (e.key.length === 1) onPick(items[next]);
    else focusItem(next);
  };

  return (
    <div
      id={id}
      role="menu"
      aria-label={label}
      data-testid="w98-start-submenu"
      style={style}
      onKeyDown={onKeyDown}
      className={cn(
        "hd-w98-start-submenu w98-raised-dark bg-raised-surface absolute z-[61] py-[2px] min-w-[180px]",
        // Beside its item on a desktop; on a phone, over the menu's right
        // half, so it stays on a 320 px screen.
        large ? "right-0" : "left-full",
      )}
    >
      {items.map((item, i) => (
        <button
          key={item.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="menuitem"
          tabIndex={i === active ? 0 : -1}
          data-testid={`w98-start-${item.id}`}
          onFocus={() => setActive(i)}
          onMouseEnter={() => focusItem(i)}
          onClick={() => onPick(item)}
          className={cn(
            "hd-w98-menu-item w-full flex items-center gap-2 text-left cursor-pointer w98-font",
            large ? "min-h-touch px-3 text-hd-body" : "px-2 py-[5px] text-hd-12",
          )}
        >
          <Win98Icon name={item.icon} size={large ? 24 : 16} className="flex-shrink-0" />
          <span className="truncate">
            <AccelLabel label={item.label} accel={item.accel} />
          </span>
        </button>
      ))}
    </div>
  );
}
