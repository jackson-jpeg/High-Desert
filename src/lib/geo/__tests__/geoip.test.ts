// @vitest-environment node
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CITY_MAX_RADIUS_KM, UNKNOWN, bareAddress, fromRecord, lookup, resetGeoForTests } from "../geoip";

/**
 * The geo lookup: what a database record is reduced to (country, region, a
 * city only when the database vouches for it), the address forms nginx can
 * send, and "unknown" on every failure instead of an error. With
 * GEOIP_TEST_DB pointing at a real DB-IP or GeoLite2 file, the last block
 * checks known addresses against it.
 */

afterEach(() => {
  delete process.env.GEOIP_DB;
  resetGeoForTests();
});

const dbip = {
  city: { names: { en: "Rohnert Park" } },
  country: { iso_code: "US", names: { en: "United States" } },
  location: { latitude: 38.3, longitude: -122.7 },
  subdivisions: [{ names: { en: "California" } }],
};

describe("fromRecord", () => {
  it("DB-IP Lite: country and state, never a city (it reports no accuracy)", () => {
    expect(fromRecord(dbip)).toEqual({ country: "US", region: "California", city: null });
  });

  it("GeoLite2: a city only within the accuracy radius", () => {
    const near = { ...dbip, location: { accuracy_radius: 20 } };
    const far = { ...dbip, location: { accuracy_radius: CITY_MAX_RADIUS_KM + 1 } };
    expect(fromRecord(near)).toEqual({ country: "US", region: "California", city: "Rohnert Park" });
    expect(fromRecord(far).city).toBeNull();
  });

  it("no country is unknown; a registered country stands in for a missing one", () => {
    expect(fromRecord({ subdivisions: [{ names: { en: "California" } }] })).toEqual(UNKNOWN);
    expect(fromRecord({ registered_country: { iso_code: "de" } })).toEqual({ country: "DE", region: null, city: null });
    expect(fromRecord(null)).toEqual(UNKNOWN);
  });
});

describe("bareAddress", () => {
  it.each([
    ["203.0.113.9", "203.0.113.9"],
    ["203.0.113.9:4431", "203.0.113.9"],
    ["::ffff:203.0.113.9", "203.0.113.9"],
    ["[2001:db8::1]:443", "2001:db8::1"],
    ["2001:DB8::1", "2001:db8::1"],
    ["fe80::1%eth0", "fe80::1"],
    ["203.0.113.9, 10.0.0.1", "203.0.113.9"],
  ])("%s → %s", (raw, bare) => expect(bareAddress(raw)).toBe(bare));

  it.each(["", "unknown", "999.1.1.1", "not-an-ip", "1.2.3"])("%s → null", (raw) => expect(bareAddress(raw)).toBeNull());
});

describe("lookup without a usable database", () => {
  it("a missing file is unknown, not an error", () => {
    process.env.GEOIP_DB = "/nonexistent/city.mmdb";
    expect(lookup("8.8.8.8")).toEqual(UNKNOWN);
  });

  it("a corrupt file is unknown, not an error", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "geoip-"));
    try {
      writeFileSync(path.join(dir, "city.mmdb"), "not a database");
      process.env.GEOIP_DB = path.join(dir, "city.mmdb");
      expect(lookup("8.8.8.8")).toEqual(UNKNOWN);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const REAL = process.env.GEOIP_TEST_DB;
(REAL ? describe : describe.skip)("lookup against a real database (GEOIP_TEST_DB)", () => {
  it("resolves known addresses, and private ones to nothing", () => {
    process.env.GEOIP_DB = REAL;
    expect(lookup("8.8.8.8").country).toBe("US");
    expect(lookup("81.2.69.142").country).toBe("GB");
    expect(lookup("::ffff:8.8.8.8").country).toBe("US");
    expect(lookup("10.0.0.1")).toEqual(UNKNOWN);
    expect(lookup("192.168.1.1")).toEqual(UNKNOWN);
  });
});
