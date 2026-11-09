"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Window } from "@/components/win98";
import { SponsorAd } from "@/components/live/SponsorAd";
import { SPONSOR_IDS, SPONSORS, type SponsorId } from "@/lib/support/sponsors";
import { safeGetItem, safeSetItem } from "@/lib/utils/safe-storage";
import { useAdminStore } from "@/stores/admin-store";
import { noteSponsor } from "@/services/stats/sponsor-client";

/** localStorage: which sponsor the last visit showed, so the next shows the one after. */
export const SPONSOR_ROTATION_KEY = "hd-sponsor-next";
/** sessionStorage: this visit's sponsor, so a revisit of /stats in one sitting keeps it. */
export const SPONSOR_VISIT_KEY = "hd-sponsor-visit";

/** Pure: the sponsor after `last` in turn (the first when there is none). */
export function nextSponsor(last: string | null): SponsorId {
  const i = SPONSOR_IDS.indexOf(last as SponsorId);
  return SPONSOR_IDS[(i + 1) % SPONSOR_IDS.length];
}

/** This visit's sponsor: kept for the sitting, the next in turn on a new one. */
export function sponsorForVisit(): SponsorId {
  const held = safeGetItem("session", SPONSOR_VISIT_KEY);
  if (held && (SPONSOR_IDS as string[]).includes(held)) return held as SponsorId;
  const pick = nextSponsor(safeGetItem("local", SPONSOR_ROTATION_KEY));
  safeSetItem("local", SPONSOR_ROTATION_KEY, pick);
  safeSetItem("session", SPONSOR_VISIT_KEY, pick);
  return pick;
}

const noSubscription = () => () => {};

interface Totals {
  app: SponsorId;
  heard: number;
  seenChat: number;
  seenStats: number;
  clicksChat: number;
  clicksStats: number;
  mutes: number;
}

/** Admin mode only: the last 30 days, per app (GET /api/stats/sponsors). */
function SponsorNumbers() {
  const [apps, setApps] = useState<Totals[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/stats/sponsors?days=30")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { apps?: Totals[] } | null) => live && setApps(d?.apps ?? null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  if (!apps) return null;
  return (
    <table className="w-full text-hd-12 md:text-hd-10 text-desktop-gray" data-testid="sponsor-numbers">
      <caption className="text-left text-bevel-dark pb-1">Last 30 days (admin)</caption>
      <thead>
        <tr className="text-bevel-dark text-left">
          <th className="font-normal">App</th>
          <th className="font-normal">Heard</th>
          <th className="font-normal">Cards</th>
          <th className="font-normal">Panel</th>
          <th className="font-normal">Clicks</th>
          <th className="font-normal">Mutes</th>
        </tr>
      </thead>
      <tbody>
        {apps.map((a) => (
          <tr key={a.app}>
            <td>{SPONSORS[a.app]?.name ?? a.app}</td>
            <td>{a.heard}</td>
            <td>{a.seenChat}</td>
            <td>{a.seenStats}</td>
            <td>{a.clicksChat + a.clicksStats}</td>
            <td>{a.mutes}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * "Station sponsors" on /stats (docs/station-breaks.md): one of Jackson's apps
 * per visit, in turn, as the same print ad as the chat card. Apart from
 * Supporters, which thanks listeners; this is the station's own word.
 */
export function StationSponsors() {
  // Storage decides, after hydration (the server render has none). The
  // snapshot is stable: after the first read the visit's pick is held.
  const id = useSyncExternalStore<SponsorId | null>(noSubscription, sponsorForVisit, () => null);
  const isAdmin = useAdminStore((s) => s.isAdmin);
  useEffect(() => {
    if (id) noteSponsor(id, "stats", "seen", "visit");
  }, [id]);
  return (
    <Window title="Station sponsors" variant="dark" headingLevel={2}>
      <div className="hd-sponsors-panel p-3 flex flex-col gap-3" data-testid="station-sponsors">
        <p className="text-hd-12 md:text-hd-10 text-bevel-dark">
          The station&rsquo;s own sponsor: an app by the guy who keeps High Desert on the air.
        </p>
        {id && <SponsorAd id={id} surface="stats" />}
        {isAdmin && <SponsorNumbers />}
      </div>
    </Window>
  );
}
