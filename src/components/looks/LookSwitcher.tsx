"use client";

import { useState } from "react";
import { useLook } from "@/hooks/useLook";
import { LOOK_LABELS, LOOKS, type Look } from "@/lib/look/look";

/**
 * Ask the phone lines' admin route for a look (services/live/lib/look.mjs),
 * then reload so the proxy and the boot script apply it. Resolves to an error
 * message, or never (the page reloads).
 */
export async function requestLook(look: Look): Promise<string> {
  try {
    const r = await fetch("/live-api/admin/look", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ look }),
      credentials: "same-origin",
    });
    if (r.status === 401) return "Sign in with your admin link first.";
    if (!r.ok) return `The switch failed (${r.status}).`;
  } catch {
    return "The switch failed. Check the connection.";
  }
  window.location.reload();
  return new Promise<string>(() => {});
}

/**
 * The owner's switcher, on every page while a preview look is on. Only an
 * admin can turn a preview on (src/lib/look/look.ts), so a public visitor
 * never sees this; turning one on happens at /look.
 */
export function LookSwitcher() {
  const look = useLook();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (look === "default") return null;
  return (
    <div
      data-testid="look-switcher"
      data-look-active={look}
      className="hd-look-switcher bg-raised-surface w98-raised-dark text-desktop-gray fixed z-[300] right-2 top-[calc(var(--safe-top)+8px)] md:top-auto md:bottom-10 text-hd-caption"
    >
      {open ? (
        <div role="group" aria-label="Preview look" className="hd-look-switcher-panel flex flex-col gap-1 p-2">
          {LOOKS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === look}
              className="hd-look-switcher-option min-h-touch md:min-h-0 px-3 py-1 text-left"
              onClick={async () => setError(await requestLook(l))}
            >
              {LOOK_LABELS[l]}
            </button>
          ))}
          {error && <p className="max-w-[180px]">{error}</p>}
          <button type="button" className="hd-look-switcher-option px-3 py-1" onClick={() => setOpen(false)}>
            Close
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="hd-look-switcher-pill min-h-touch md:min-h-0 px-3 py-1"
          onClick={() => setOpen(true)}
          aria-label={`Preview look: ${LOOK_LABELS[look]}. Change look`}
        >
          Look: {LOOK_LABELS[look]}
        </button>
      )}
    </div>
  );
}
