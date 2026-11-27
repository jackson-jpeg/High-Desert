import type { Guest } from "@/lib/shows/catalog";
import { longDate } from "@/lib/shows/describe";

/**
 * A guest as a late-night phone message (docs/UI-PLAN.md, push 4): the pink
 * slip left on the studio desk, with the guest's name typed in, what they
 * called about, how many nights they were on, and their first and last call.
 * Everything on it comes from the catalog; nothing is invented (no line
 * number, no phone number, no message in their words).
 *
 * Server HTML, so it works without JavaScript and a crawler reads it. The
 * page's h1 (the guest's name) sits inside the slip as its "From" line.
 * Colours: src/styles/call-slip.css, both looks.
 */
export function CallSlip({ guest, about, heading }: { guest: Guest; about: string | null; heading?: "h1" | "p" }) {
  const nights = guest.shows.length;
  const first = guest.shows[0]?.row.airDate ?? null;
  const last = guest.shows[nights - 1]?.row.airDate ?? null;
  const Name = heading ?? "h1";
  return (
    <div className="hd-call-slip" data-call-slip="">
      <p className="hd-call-slip-head" aria-hidden="true">
        <span>Phone message</span>
        <span className="hd-call-slip-stamp">High Desert</span>
      </p>
      <dl className="hd-call-slip-fields">
        <div className="hd-call-slip-row">
          <dt>For</dt>
          <dd>Art Bell</dd>
        </div>
        <div className="hd-call-slip-row">
          <dt>From</dt>
          <dd>
            <Name className="hd-call-slip-name hd-show-title">{guest.name}</Name>
          </dd>
        </div>
        {about && (
          <div className="hd-call-slip-row">
            <dt>Re</dt>
            <dd data-call-slip-about="">{about}</dd>
          </div>
        )}
        <div className="hd-call-slip-row">
          <dt>On the air</dt>
          <dd data-call-slip-nights={nights}>
            {nights === 1 ? "One night" : `${nights} nights`}
            {first && last && first !== last ? `, ${longDate(first)} to ${longDate(last)}` : first ? `, ${longDate(first)}` : ""}
          </dd>
        </div>
      </dl>
      <ul className="hd-call-slip-boxes" aria-label="Noted">
        <li data-checked="">Telephoned</li>
        <li data-checked={nights > 1 ? "" : undefined}>Called again</li>
        <li data-checked="">On the air</li>
      </ul>
    </div>
  );
}
