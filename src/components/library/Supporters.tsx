"use client";

import { Window } from "@/components/win98";
import { SUPPORTERS, VENMO_HANDLE, VENMO_URL, type Supporter } from "@/lib/support/supporters";

/** The thank-you list and the way to join it (2026-10-09). */
export function Supporters({ supporters = SUPPORTERS }: { supporters?: readonly Supporter[] }) {
  return (
    <Window title="Supporters" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-3" data-testid="supporters">
        <p className="text-hd-12 md:text-hd-10 text-desktop-gray">
          High Desert has no ads. Thank you to the listeners who chipped in to keep it on the air.
        </p>
        {supporters.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Thank you">
            {supporters.map((s, i) => (
              <li
                key={`${s.name}-${i}`}
                className="w98-inset-dark px-2 py-1 text-hd-12 md:text-hd-10 text-desktop-gray"
              >
                {s.name} <span className="text-static-green">${s.amount}</span>
              </li>
            ))}
          </ul>
        )}
        <a
          href={VENMO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start inline-flex items-center min-h-touch md:min-h-0 text-hd-12 md:text-hd-10 text-signal-blue underline underline-offset-2"
        >
          Chip in on Venmo: @{VENMO_HANDLE}
        </a>
      </div>
    </Window>
  );
}
