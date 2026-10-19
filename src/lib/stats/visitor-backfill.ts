/**
 * The visitors backfill, as arithmetic (docs/visitors.md, "Backfill").
 *
 * Before `visitors` existed, the only per-browser count was the arrival
 * funnel: `funnel_daily` counts each new browser once, on the UTC day it first
 * arrived, with its device and (from 2026-10-12) its look. It holds no id. So
 * the backfill is placeholders: one `origin = 'funnel'` row per counted
 * arrival, with no location.
 *
 * A browser that posts to /api/stats/visitor sends its own funnel arrival
 * (cohort day, device, look). It is the same browser as one of those
 * placeholders, so it takes one's place. This function says how many
 * placeholders each (day, device, look) should hold given everything so far:
 *
 *   placeholders(day, device) = max(0, arrivals − browsers that claimed that cohort)
 *
 * split across looks by what is left in each look; a claimed browser whose
 * look does not match (it switched looks before its first visitor post) is
 * taken from the unknown-look placeholders first, so the (day, device) total
 * is always exact. `returners` is how many of the placeholders count two visit
 * days rather than one: the funnel's `return` step for that cohort, scaled to
 * the placeholders left. That is the one estimate here, and it only moves
 * visit_days, never the count of visitors.
 *
 * Pure, so it is tested without a database; the database half is
 * reconcileVisitorBackfill() in src/services/stats/db/visitors.ts.
 */

export type BackfillDevice = "phone" | "desktop";
export type BackfillLook = "win98" | "night" | null;

export interface DayDeviceLookCount {
  day: string;
  device: BackfillDevice;
  look: BackfillLook;
  n: number;
}

export interface DayDeviceCount {
  day: string;
  device: BackfillDevice;
  n: number;
}

export interface PlaceholderPlan {
  day: string;
  device: BackfillDevice;
  /** Placeholders wanted per look; keys are "win98", "night" and "none". */
  looks: Record<"win98" | "night" | "none", number>;
  /** Of them, how many count two visit days (the funnel saw them return). */
  returners: number;
}

const LOOK_ORDER = ["win98", "night", "none"] as const;
const lookKey = (l: BackfillLook) => (l ?? "none") as (typeof LOOK_ORDER)[number];

export function planPlaceholders(
  arrivals: DayDeviceLookCount[],
  returns: DayDeviceCount[],
  claimed: DayDeviceLookCount[],
): PlaceholderPlan[] {
  type Acc = { f: Record<string, number>; b: Record<string, number>; r: number };
  const by = new Map<string, Acc>();
  const acc = (day: string, device: BackfillDevice) => {
    const k = `${day}|${device}`;
    let a = by.get(k);
    if (!a) by.set(k, (a = { f: {}, b: {}, r: 0 }));
    return a;
  };
  for (const a of arrivals) {
    if (a.n <= 0) continue;
    const x = acc(a.day, a.device);
    x.f[lookKey(a.look)] = (x.f[lookKey(a.look)] ?? 0) + a.n;
  }
  for (const c of claimed) {
    if (c.n <= 0) continue;
    const x = acc(c.day, c.device);
    x.b[lookKey(c.look)] = (x.b[lookKey(c.look)] ?? 0) + c.n;
  }
  for (const r of returns) {
    if (r.n > 0) acc(r.day, r.device).r += r.n;
  }

  const out: PlaceholderPlan[] = [];
  for (const [k, x] of [...by].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const [day, device] = k.split("|") as [string, BackfillDevice];
    const F = LOOK_ORDER.reduce((s, l) => s + (x.f[l] ?? 0), 0);
    const B = LOOK_ORDER.reduce((s, l) => s + (x.b[l] ?? 0), 0);
    const need = Math.max(0, F - B);
    if (F === 0) continue;

    // What each look has left after its own claims, then the total made exact
    // by trimming, the unknown look first (it is the least informative). The
    // per-look sum is never below `need` (a sum of max(0, f − b) is at least
    // the sum of f − b), so trimming is the only correction there is.
    const looks = { win98: 0, night: 0, none: 0 };
    for (const l of LOOK_ORDER) looks[l] = Math.max(0, (x.f[l] ?? 0) - (x.b[l] ?? 0));
    let excess = looks.win98 + looks.night + looks.none - need;
    for (const l of ["none", "night", "win98"] as const) {
      const cut = Math.min(excess, looks[l]);
      looks[l] -= cut;
      excess -= cut;
    }

    const returners = need === 0 ? 0 : Math.min(need, Math.round((Math.min(x.r, F) * need) / F));
    out.push({ day, device, looks, returners });
  }
  return out;
}
