"use client";

import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils/cn";
import { startMenuKey, type StartItem } from "./start-menu";
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
 */
export function StartMenu({
  items,
  onPick,
  onClose,
  large = false,
}: {
  items: StartItem[];
  onPick: (item: StartItem) => void;
  onClose: (opts: { restoreFocus: boolean }) => void;
  /** Phone: 44 px rows. */
  large?: boolean;
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
    const next = startMenuKey(e.key, active, items);
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key.length === 1) onPick(items[next]);
    else focusItem(next);
  };

  return (
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
        {items.map((item, i) => (
          <Fragment key={item.id}>
            {item.separatorBefore && <li role="separator" className="hd-w98-menu-sep" />}
            <li role="none">
              <button
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
                <Win98Icon name={item.icon} size={large ? 24 : 20} className="flex-shrink-0" />
                <span className="truncate">
                  <AccelLabel label={item.label} accel={item.accel} />
                </span>
              </button>
            </li>
          </Fragment>
        ))}
      </ul>
    </div>
  );
}
