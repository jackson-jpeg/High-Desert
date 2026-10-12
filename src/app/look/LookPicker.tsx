"use client";

import { useEffect, useState } from "react";
import { useLook } from "@/hooks/useLook";
import { LOOK_LABELS, LOOKS } from "@/lib/look/look";
import { requestLook } from "@/components/looks/LookSwitcher";

export function LookPicker() {
  const look = useLook();
  const [admin, setAdmin] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/live-api/me", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => live && setAdmin(me?.admin === true))
      .catch(() => live && setAdmin(false));
    return () => { live = false; };
  }, []);

  return (
    <section className="w-full max-w-sm flex flex-col gap-3" aria-labelledby="look-heading">
      <h1 id="look-heading" className="text-hd-h3">Look</h1>
      <p className="text-bevel-dark">Now showing: {LOOK_LABELS[look]}.</p>
      {admin === null && <p className="text-bevel-dark">Checking your sign-in.</p>}
      {admin === false && (
        <p className="text-bevel-dark">
          Only the owner can switch looks. Open your admin sign-in link on this device first.
        </p>
      )}
      {admin && (
        <div className="flex flex-col gap-2" role="group" aria-label="Choose a look">
          {LOOKS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={l === look}
              data-testid={`look-${l}`}
              className="min-h-touch w98-raised-dark bg-raised-surface px-3 py-2 text-left"
              onClick={async () => setError(await requestLook(l))}
            >
              {LOOK_LABELS[l]}
            </button>
          ))}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <a href="/live" className="text-signal-blue underline">Back to the station</a>
    </section>
  );
}
