"use client";

import type { LibraryView } from "@/lib/library/intents";

const OPTIONS: { view: LibraryView; label: string }[] = [
  { view: "list", label: "List" },
  { view: "dial", label: "Dial" },
];

/**
 * List / Dial, in the library chrome (preview looks only; useLibraryView).
 * Look-agnostic markup: the looks style `hd-view-switch*`.
 */
export function LibraryViewSwitch({
  view,
  onChange,
}: {
  view: LibraryView;
  onChange: (view: LibraryView) => void;
}) {
  return (
    <div className="hd-view-switch flex items-center" role="group" aria-label="Browse the library as">
      {OPTIONS.map((o) => (
        <button
          key={o.view}
          type="button"
          aria-pressed={view === o.view}
          data-testid={`library-view-${o.view}`}
          className="hd-view-switch-option min-h-touch md:min-h-0 px-2.5 py-1 text-hd-caption cursor-pointer"
          onClick={() => onChange(o.view)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
