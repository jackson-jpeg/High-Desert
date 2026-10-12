"use client";

import { useId } from "react";
import { Dialog } from "@/components/win98/Dialog";
import { Button } from "@/components/win98/Button";
import { LOOKS, LOOK_LABELS } from "@/lib/look/look";
import { LookPreview, LOOK_DESCRIPTIONS } from "../LookPreview";
import { useLookChoice } from "../useLookChoice";

/**
 * Start > Settings > Display (and View > Display... on the desktop menu bar):
 * Windows 98's Display Properties, with one Appearance tab whose schemes are
 * the site's two looks. OK applies and closes, Cancel closes, Apply applies.
 * Applying sets the cookie and reloads (src/lib/look/choice.ts), so the page
 * comes back rendered in the new look by the server.
 *
 * The scheme list is native radio buttons in a fieldset: arrows move the
 * choice, and a screen reader hears "Scheme, Win98, radio button, 1 of 2".
 */
export function DisplayProperties({ onClose }: { onClose: () => void }) {
  const { current, choice, setChoice, changed, apply } = useLookChoice();
  const name = useId();
  const descId = useId();

  const ok = () => {
    if (changed) apply();
    else onClose();
  };

  return (
    <Dialog open onClose={onClose} title="Display Properties" width="400px">
      <div className="flex flex-col gap-2 p-2" data-testid="w98-display">
        {/* One tab, drawn as Windows drew it; not a tablist, as there is nothing to switch to. */}
        <div className="hd-w98-proptabs flex">
          <span className="hd-w98-proptab text-hd-12 px-3 py-[3px]">Appearance</span>
        </div>
        <div className="hd-w98-propsheet flex flex-col gap-3 p-3">
          <div className="hd-w98-monitor mx-auto">
            <LookPreview look={choice} className="hd-w98-monitor-screen w-[160px] h-[110px]" />
          </div>
          <fieldset className="flex flex-col gap-1" aria-describedby={descId}>
            <legend className="text-hd-12 mb-1">
              <span className="underline underline-offset-2">S</span>cheme:
            </legend>
            {LOOKS.map((look) => (
              <label
                key={look}
                className="flex items-center gap-2 text-hd-12 min-h-touch md:min-h-0 py-[2px] cursor-pointer"
              >
                <input
                  type="radio"
                  name={name}
                  value={look}
                  checked={choice === look}
                  onChange={() => setChoice(look)}
                  data-testid={`w98-display-${look}`}
                />
                {LOOK_LABELS[look]}
                {look === current && <span className="text-hd-12 text-bevel-dark">(current)</span>}
              </label>
            ))}
          </fieldset>
          <p id={descId} className="text-hd-12" data-testid="w98-display-desc">
            {LOOK_DESCRIPTIONS[choice]}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="dark" onClick={ok} data-testid="w98-display-ok">
            OK
          </Button>
          <Button variant="dark" onClick={onClose} data-testid="w98-display-cancel">
            Cancel
          </Button>
          <Button variant="dark" onClick={apply} disabled={!changed} data-testid="w98-display-apply">
            Apply
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
