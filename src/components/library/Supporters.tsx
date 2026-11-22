"use client";

import { Window } from "@/components/win98";
import {
  PAYPAL_HANDLE,
  PAYPAL_URL,
  SUPPORTERS,
  VENMO_HANDLE,
  VENMO_URL,
  groupByTier,
  tierLine,
  totalOf,
  type Supporter,
} from "@/lib/support/supporters";

const LINK =
  "inline-flex items-center min-h-touch md:min-h-0 text-hd-12 md:text-hd-10 text-signal-blue underline underline-offset-2";

/** The thank-you list, grouped by tier (2026-11-22), and the way to join it (2026-10-09). */
export function Supporters({ supporters = SUPPORTERS }: { supporters?: readonly Supporter[] }) {
  const groups = groupByTier(supporters);
  return (
    <Window title="Supporters" variant="dark" headingLevel={2}>
      <div className="p-3 flex flex-col gap-3" data-testid="supporters">
        <p className="text-hd-12 md:text-hd-10 text-desktop-gray">
          High Desert runs no outside ads. Thank you to the listeners who chipped in to keep it on the air.
        </p>
        {groups.length > 0 && (
          <div className="flex flex-col gap-2" data-testid="supporter-tiers">
            {groups.map(({ tier, supporters: people }) => (
              <section key={tier.id} className="flex flex-col gap-1" data-tier={tier.id}>
                <h3 className="text-hd-12 md:text-hd-10 text-bevel-dark uppercase tracking-wide">{tier.name}</h3>
                <ul className="flex flex-wrap gap-2" aria-label={tier.name}>
                  {people.map((s, i) => (
                    <li
                      key={`${s.name}-${i}`}
                      className="w98-inset-dark px-2 py-1 text-hd-12 md:text-hd-10 text-desktop-gray"
                    >
                      {s.name} <span className="text-static-green">${totalOf(s)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        {/* Venmo first (most supporters so far), PayPal for everyone outside the US. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1" data-testid="donate-links">
          <a href={VENMO_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
            Chip in on Venmo: @{VENMO_HANDLE}
          </a>
          <a href={PAYPAL_URL} target="_blank" rel="noopener noreferrer" className={LINK}>
            PayPal: paypal.me/{PAYPAL_HANDLE}
          </a>
        </div>
        <p className="text-hd-12 md:text-hd-10 text-bevel-dark/85" data-testid="supporter-tier-line">
          {tierLine()} Your tier counts every gift together.
        </p>
      </div>
    </Window>
  );
}
