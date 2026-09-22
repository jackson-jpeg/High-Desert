// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * deploy/nginx/highdesert.conf is the versioned copy of the production vhost
 * (installed to /etc/nginx/sites-available/highdesert; `highdesert-status`
 * WARNs on drift). These are the properties HD-007 depends on, asserted on the
 * file that gets installed. `nginx -t` checks syntax; this checks intent.
 */

const conf = readFileSync(path.resolve(__dirname, "../../deploy/nginx/highdesert.conf"), "utf8")
  .split("\n")
  .map((l) => l.replace(/#.*$/, ""))
  .join("\n");

/** Top-level-in-block body of the first `location <spec> {…}`, braces balanced. */
function location(spec: string): string | null {
  const start = conf.indexOf(`location ${spec} {`);
  if (start < 0) return null;
  let depth = 0;
  for (let i = conf.indexOf("{", start); i < conf.length; i++) {
    if (conf[i] === "{") depth++;
    if (conf[i] === "}" && --depth === 0) return conf.slice(conf.indexOf("{", start) + 1, i);
  }
  return null;
}

function allLocations(): string[] {
  return [...conf.matchAll(/location\s+([^{]+)\{/g)].map((m) => m[1].trim());
}

describe("nginx vhost — stats write limit", () => {
  it("defines a zone keyed on the client address for POSTs only", () => {
    const zone = /limit_req_zone\s+\$(\S+)\s+zone=hd_stats_write:\d+m\s+rate=(\d+)r\/m;/.exec(conf);
    expect(zone).not.toBeNull();
    const [, keyVar, rate] = zone!;
    // The key is a map on the method: the address for POST, empty (= not
    // limited) otherwise.
    const map = new RegExp(`map\\s+\\$request_method\\s+\\$${keyVar}\\s*\\{([^}]*)\\}`).exec(conf);
    expect(map).not.toBeNull();
    expect(map![1]).toMatch(/POST\s+\$binary_remote_addr;/);
    expect(map![1]).toMatch(/default\s+"";/);
    expect(Number(rate)).toBeGreaterThan(0);
  });

  it("covers every POST stats location: /api/stats/* and /api/playback-event", () => {
    for (const spec of ["^~ /api/stats/", "= /api/playback-event"]) {
      const body = location(spec);
      expect(body, spec).not.toBeNull();
      expect(body!, spec).toMatch(/limit_req\s+zone=hd_stats_write\s+burst=\d+\s+nodelay;/);
      expect(body!, spec).toMatch(/proxy_pass\s+http:\/\/highdesert_app;/);
    }
  });

  it("no other location can take /api/stats/ or /api/playback-event away from those", () => {
    // `^~` wins over regex locations for its prefix and `=` wins over all, but
    // a longer plain prefix under /api/stats/ would win and skip the limit.
    for (const spec of allLocations()) {
      const target = spec.replace(/^(=|\^~|~\*?)\s*/, "");
      if (spec === "^~ /api/stats/" || spec === "= /api/playback-event") continue;
      expect(target.startsWith("/api/stats/") || target.startsWith("/api/playback-event"), spec).toBe(false);
      expect(spec.startsWith("~"), `regex location ${spec} could shadow /api/playback-event`).toBe(false);
    }
  });

  it("refuses with 429, not nginx's default 503", () => {
    expect(conf).toMatch(/limit_req_status\s+429;/);
  });

  it("still OVERWRITES X-Forwarded-For, and no location redefines the proxy headers", () => {
    // The app's limiter keys on this header. Appending would let a client pick
    // its own identity; a location with its own proxy_set_header would silently
    // drop every inherited one, this included.
    expect(conf).toMatch(/proxy_set_header\s+X-Forwarded-For\s+\$remote_addr;/);
    expect(conf).not.toMatch(/\$proxy_add_x_forwarded_for/);
    for (const spec of allLocations()) {
      expect(location(spec) ?? "", spec).not.toMatch(/proxy_set_header/);
    }
  });
});
