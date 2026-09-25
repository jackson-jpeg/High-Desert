// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderMirrorNginx, PRODUCTION } from "../../services/mirror/lib/nginx.mjs";

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

describe("nginx vhost — the phone lines (/live-api/)", () => {
  it("proxies /live-api/ to the chat service on loopback, path unchanged, with its own POST limit", () => {
    const body = location("^~ /live-api/");
    expect(body).not.toBeNull();
    // No URI part after the port: nginx passes /live-api/... through as is.
    expect(body!).toMatch(/proxy_pass\s+http:\/\/127\.0\.0\.1:3005;/);
    expect(body!).toMatch(/limit_req\s+zone=hd_live_write\s+burst=\d+\s+nodelay;/);
    const map = /map\s+\$request_method\s+\$hd_live_write_key\s*\{([^}]*)\}/.exec(conf);
    expect(map![1]).toMatch(/POST\s+\$binary_remote_addr;/);
    expect(map![1]).toMatch(/default\s+"";/);
  });

  it("the stream is unbuffered, long-lived, and capped per address", () => {
    const body = location("= /live-api/stream");
    expect(body).not.toBeNull();
    expect(body!).toMatch(/proxy_pass\s+http:\/\/127\.0\.0\.1:3005;/);
    expect(body!).toMatch(/proxy_buffering\s+off;/);
    expect(body!).toMatch(/proxy_read_timeout\s+1h;/);
    expect(body!).toMatch(/limit_conn\s+hd_live_streams\s+\d+;/);
  });

  it("health is not public", () => {
    expect(location("= /live-api/health")).toMatch(/return\s+404;/);
  });
});

describe("nginx vhost — the archive.org outage mirror", () => {
  const raw = readFileSync(path.resolve(__dirname, "../../deploy/nginx/highdesert.conf"), "utf8");
  const httpsServer = conf.slice(conf.indexOf("listen 187.77.218.14:443"), conf.indexOf("# HTTP — ACME"));
  const strip = (t: string) => t.split("\n").map((l) => l.replace(/#.*$/, "")).join("\n");
  const { http, locations } = renderMirrorNginx();
  const loc = strip(locations);
  const httpConf = strip(http);

  it("includes the generated mirror config: http level outside any server, locations inside the HTTPS server", () => {
    const before = conf.slice(0, conf.indexOf("server {"));
    expect(before).toMatch(/include\s+\/etc\/nginx\/highdesert-mirror\/http\.conf;/);
    expect(httpsServer).toMatch(/include\s+\/etc\/nginx\/highdesert-mirror\/locations\.conf;/);
    expect(raw).not.toMatch(/127\.0\.0\.1:3004/); // the webtorrent gateway is gone
  });

  it("every mirror location is under /mirror/, so none can take /api/stats/ or the app away", () => {
    for (const m of loc.matchAll(/location\s+([^{]+)\{/g)) {
      const spec = m[1].trim().replace(/^"|"$/g, "");
      if (spec.startsWith("@")) continue;
      const target = spec.replace(/^(=|\^~|~\*?)\s*"?/, "");
      expect(target.startsWith("/mirror/") || target.startsWith("^/mirror/"), spec).toBe(true);
    }
  });

  it("limits connections per address and never redefines add_header (the server's HSTS must be inherited)", () => {
    expect(loc).toMatch(/location \^~ \/mirror\/ \{\s*limit_conn hd_mirror \d+;/);
    expect(httpConf).toMatch(/limit_conn_zone \$binary_remote_addr zone=hd_mirror:/);
    expect(loc).not.toMatch(/add_header/);
  });

  it("sends nothing of the listener to archive.org: no client headers, no address", () => {
    for (const block of [loc.slice(loc.indexOf("location @hd_mirror_fill")), httpConf.slice(httpConf.indexOf("server {"))]) {
      expect(block).toMatch(/proxy_pass_request_headers off;/);
      expect(block).not.toMatch(/X-Forwarded-For|X-Real-IP|\$remote_addr/);
    }
  });

  it("the fill server listens only on its unix socket, and follows redirects only to archive.org's storage nodes", () => {
    const listens = [...httpConf.matchAll(/listen\s+([^;]+);/g)].map((m) => m[1]);
    expect(listens).toEqual([`unix:${PRODUCTION.fillSocket}`]);
    const follow = new RegExp(PRODUCTION.followPattern);
    expect(follow.test("https://dn720703.ca.archive.org/0/items/x/y.mp3")).toBe(true);
    expect(follow.test("https://ia800300.us.archive.org/12/items/x/y.mp3")).toBe(true);
    expect(follow.test("https://archive.org.evil.example/x")).toBe(false);
    expect(follow.test("http://ia800300.us.archive.org/x")).toBe(false);
    expect(httpConf).toMatch(/proxy_ssl_verify on;/);
  });

  it("the cache is bounded: 20 GB and never under 10 GB free", () => {
    expect(httpConf).toMatch(/proxy_cache_path \/var\/cache\/highdesert-mirror\/proxy .*max_size=20g min_free=10g/);
  });
});
