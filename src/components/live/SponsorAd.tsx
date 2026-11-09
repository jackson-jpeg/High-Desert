"use client";

import { SPONSOR_LINE, SPONSORS, type SponsorId } from "@/lib/support/sponsors";
import { noteSponsor, type SponsorSurface } from "@/services/stats/sponsor-client";

/**
 * The print ad (docs/station-breaks.md): a serif headline and copy, the app's
 * name in the station's bitmap face, a dashed "Clip and save" coupon with the
 * App Store's own price, and Get the app. One look per site look, from CSS
 * under html[data-look] (src/styles/station-break.css): newsprint and ink in
 * Win98, card stock and amber in Night. `flying` sends the small plane across
 * over `durationSec`, starting `elapsedSec` in.
 */
export function SponsorAd({
  id,
  surface,
  flying = false,
  durationSec = 18,
  elapsedSec = 0,
}: {
  id: SponsorId;
  surface: Exclude<SponsorSurface, "air">;
  flying?: boolean;
  durationSec?: number;
  elapsedSec?: number;
}) {
  const s = SPONSORS[id];
  return (
    <div className="hd-sponsor-ad" data-testid="sponsor-ad" data-app={id}>
      {flying && (
        <span
          className="hd-sponsor-plane"
          aria-hidden="true"
          data-testid="sponsor-plane"
          style={{ animationDuration: `${durationSec}s`, animationDelay: `-${Math.max(0, elapsedSec)}s` }}
        >
          <svg viewBox="0 0 16 8" width="24" height="12" shapeRendering="crispEdges">
            <path d="M0 3h2v1h9V2h1v1h2v1h2v1h-2v1h-2v1h-1V5H2v1H0z" fill="currentColor" />
          </svg>
        </span>
      )}
      <p className="hd-sponsor-headline">{s.headline}</p>
      <p className="hd-sponsor-name" data-testid="sponsor-name">
        {s.name}
      </p>
      <p className="hd-sponsor-body">{s.body}</p>
      <div className="hd-sponsor-coupon" data-testid="sponsor-coupon">
        <span className="hd-sponsor-clip">Clip and save</span>
        <span className="hd-sponsor-price">{s.price}</span>
      </div>
      <a
        href={s.appStoreUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="hd-sponsor-get"
        data-testid="sponsor-get"
        onClick={() => noteSponsor(id, surface, "click")}
      >
        Get the app
      </a>
      <p className="hd-sponsor-line">{SPONSOR_LINE}</p>
    </div>
  );
}
