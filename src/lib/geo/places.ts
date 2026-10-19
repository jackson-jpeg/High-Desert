/**
 * Names for the places the geo database answers with (docs/visitors.md).
 * Countries are stored as ISO codes and named here; US states are stored by
 * their English name, as the database gives it, and given their postal code
 * here for a map.
 */

let names: Intl.DisplayNames | null = null;

/** "US" → "United States". The code itself when the runtime has no name for it. */
export function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    names ??= new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export const US_STATES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO",
  Connecticut: "CT", Delaware: "DE", "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS", Kentucky: "KY",
  Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI",
  "South Carolina": "SC", "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV", Wisconsin: "WI", Wyoming: "WY",
};

/** "California" → "CA"; null for anything that is not one of the 50 states or DC. */
export function usStateCode(region: string | null): string | null {
  return region ? (US_STATES[region] ?? null) : null;
}

/**
 * DB-IP's licence (CC BY 4.0) asks for this on any page that shows its data.
 * The API carries it so the stats page cannot forget it.
 */
export const GEO_ATTRIBUTION = { text: "IP Geolocation by DB-IP", url: "https://db-ip.com" } as const;
