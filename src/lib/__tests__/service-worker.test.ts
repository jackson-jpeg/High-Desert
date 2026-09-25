// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * HD-034: the real `public/sw.js`, run in a vm context with a fake `self`,
 * `caches` and `fetch`. Nothing here re-implements the worker — the script is
 * read from disk and its own `fetch` listener answers the events.
 *
 * The API fallback used to read a cache nothing ever wrote to, so an offline
 * API call always got a body-less 504 and every caller's `res.json()` threw.
 */

const ORIGIN = "https://highdesert.space";
const SW_SOURCE = readFileSync(path.resolve(import.meta.dirname, "../../../public/sw.js"), "utf8");

type Listener = (event: unknown) => void;

/** A Cache API stand-in keyed on URL, which is all `caches.match` needs here. */
class FakeCache {
  entries = new Map<string, Response>();
  async put(req: Request | string, res: Response) {
    this.entries.set(typeof req === "string" ? new URL(req, ORIGIN).href : req.url, res);
  }
  async match(req: Request | string) {
    const hit = this.entries.get(typeof req === "string" ? new URL(req, ORIGIN).href : req.url);
    return hit?.clone();
  }
  async add() {}
}

function loadWorker(buildId = "test") {
  const listeners = new Map<string, Listener>();
  const lifecycle = { skipWaiting: 0, claim: 0 };
  const store = new Map<string, FakeCache>();
  let network: (req: Request) => Promise<Response> = async () => new Response("");
  const fetched: string[] = [];

  const caches = {
    async open(name: string) {
      if (!store.has(name)) store.set(name, new FakeCache());
      return store.get(name)!;
    },
    async match(req: Request | string) {
      for (const c of store.values()) {
        const hit = await c.match(req);
        if (hit) return hit;
      }
      return undefined;
    },
    async keys() {
      return [...store.keys()];
    },
    async delete(name: string) {
      return store.delete(name);
    },
  };

  const self = {
    location: new URL(`${ORIGIN}/sw.js?v=${buildId}`),
    addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
    skipWaiting: () => {
      lifecycle.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        lifecycle.claim += 1;
      },
      matchAll: async () => [],
    },
    registration: { unregister: async () => true },
  };

  const context = vm.createContext({
    self,
    caches,
    fetch: (req: Request) => {
      fetched.push(req.url);
      return network(req);
    },
    URL,
    Response,
    Request,
    Headers,
    Promise,
    JSON,
    Set,
  });
  vm.runInContext(SW_SOURCE, context);

  /** Dispatch a fetch event. `undefined` means the worker did not respondWith. */
  async function dispatch(
    url: string,
    init: RequestInit = {},
    mode?: "navigate",
  ): Promise<Response | undefined> {
    const request = new Request(new URL(url, ORIGIN), init);
    // undici refuses to construct a navigate-mode Request; the worker only reads it.
    if (mode) Object.defineProperty(request, "mode", { value: mode });
    let responded: Promise<Response> | undefined;
    listeners.get("fetch")!({ request, respondWith: (p: Promise<Response>) => (responded = p) });
    const res = await responded;
    // Let the fire-and-forget cache.put settle.
    await new Promise((r) => setTimeout(r, 0));
    return res;
  }

  /** Run a lifecycle event (install/activate) to the end of its waitUntil. */
  async function lifecycleEvent(type: "install" | "activate") {
    let waited: Promise<unknown> | undefined;
    listeners.get(type)!({ waitUntil: (p: Promise<unknown>) => (waited = p) });
    await waited;
  }

  return {
    dispatch,
    lifecycleEvent,
    lifecycle,
    caches,
    fetched,
    online(fn: (req: Request) => Response | Promise<Response>) {
      network = async (req) => fn(req);
    },
    offline() {
      network = async () => {
        throw new TypeError("Failed to fetch");
      };
    },
  };
}

let sw: ReturnType<typeof loadWorker>;
beforeEach(() => {
  sw = loadWorker();
});

describe("service worker — API offline fallback", () => {
  it("an API call with nothing cached gets a JSON 503, not a body-less 504", async () => {
    sw.offline();
    const res = await sw.dispatch("/api/archive/search?q=ufo");
    expect(res!.status).toBe(503);
    expect(res!.headers.get("Content-Type")).toBe("application/json");
    expect(await res!.json()).toEqual({ error: "offline" });
  });

  it("a successful stats read is kept and served once the network is gone", async () => {
    sw.online(() => Response.json({ counts: { a: 3 } }));
    const live = await sw.dispatch("/api/stats/episodes?ids=a");
    expect(await live!.json()).toEqual({ counts: { a: 3 } });

    sw.offline();
    const cached = await sw.dispatch("/api/stats/episodes?ids=a");
    expect(cached!.status).toBe(200);
    expect(await cached!.json()).toEqual({ counts: { a: 3 } });
  });

  it("online, the network answer wins over what is cached", async () => {
    sw.online(() => Response.json({ counts: { a: 3 } }));
    await sw.dispatch("/api/stats/episodes?ids=a");
    sw.online(() => Response.json({ counts: { a: 4 } }));
    const res = await sw.dispatch("/api/stats/episodes?ids=a");
    expect(await res!.json()).toEqual({ counts: { a: 4 } });
  });

  it("never serves presence from cache: /api/stats/now offline is the 503, not the last on-air list", async () => {
    sw.online(() => Response.json({ online: 3, listening: 1, onAir: [], recent: [] }));
    await sw.dispatch("/api/stats/now");
    sw.offline();
    const res = await sw.dispatch("/api/stats/now");
    expect(res!.status).toBe(503);
  });

  it("never caches the legacy presence alias either, even without a no-store header", async () => {
    sw.online(() => Response.json({ count: 1, online: 2, listening: 1 }));
    await sw.dispatch("/api/stats/active");
    sw.offline();
    expect((await sw.dispatch("/api/stats/active"))!.status).toBe(503);
  });

  it("does not cache a response the server marked no-store", async () => {
    sw.online(() => Response.json({ entries: [] }, { headers: { "Cache-Control": "no-store" } }));
    await sw.dispatch("/api/stats/leaderboard?period=week");
    sw.offline();
    expect((await sw.dispatch("/api/stats/leaderboard?period=week"))!.status).toBe(503);
  });

  it("does not cache an error response", async () => {
    sw.online(() => Response.json({ error: "db" }, { status: 503 }));
    await sw.dispatch("/api/stats/community");
    sw.offline();
    const res = await sw.dispatch("/api/stats/community");
    expect(await res!.json()).toEqual({ error: "offline" });
  });

  it("does not cache POSTs; an offline POST gets the JSON 503", async () => {
    sw.online(() => Response.json({ ok: true }));
    await sw.dispatch("/api/stats/play", { method: "POST", body: "{}" });
    sw.offline();
    const res = await sw.dispatch("/api/stats/play", { method: "POST", body: "{}" });
    expect(res!.status).toBe(503);
    expect(await res!.json()).toEqual({ error: "offline" });
  });

  it("does not cache the archive.org proxies", async () => {
    sw.online(() => Response.json({ up: true }));
    await sw.dispatch("/api/archive/health");
    sw.offline();
    expect((await sw.dispatch("/api/archive/health"))!.status).toBe(503);
  });
});

describe("service worker — media is never touched", () => {
  it.each([
    ["an archive.org URL", "https://archive.org/download/x/y.mp3", {}],
    ["a Range request", "/mirror/abc", { headers: { range: "bytes=0-" } }],
    ["an audio extension", "/local/show.mp3", {}],
  ])("%s is handed back to the browser", async (_label, url, init) => {
    sw.offline();
    expect(await sw.dispatch(url, init as RequestInit)).toBeUndefined();
    expect(sw.fetched).toEqual([]);
  });
});

describe("service worker — a deploy reaches returning visitors on their next load", () => {
  // A PWA that keeps serving the build it first cached leaves people on it
  // until every tab is closed. Three properties together mean the next
  // navigation or reload after a deploy runs the new build.

  it("a new worker activates at once and takes over open pages", async () => {
    const next = loadWorker("new-build");
    await next.lifecycleEvent("install");
    expect(next.lifecycle.skipWaiting).toBe(1);
    await next.lifecycleEvent("activate");
    expect(next.lifecycle.claim).toBe(1);
  });

  it("activating purges every other build's cache and keeps its own", async () => {
    const next = loadWorker("new-build");
    await next.caches.open("hd-shell-old-build");
    await next.caches.open("hd-shell-new-build");
    await next.lifecycleEvent("activate");
    expect(await next.caches.keys()).toEqual(["hd-shell-new-build"]);
  });

  it("online, a navigation gets the server's new HTML, never the cached old page", async () => {
    await (await sw.caches.open("hd-shell-test")).put(`${ORIGIN}/library`, new Response("old build"));
    sw.online(() => new Response("new build"));
    const res = await sw.dispatch("/library", {}, "navigate");
    expect(await res!.text()).toBe("new build");
  });

  it("offline, a navigation falls back to the cached page (the control)", async () => {
    await (await sw.caches.open("hd-shell-test")).put(`${ORIGIN}/library`, new Response("old build"));
    sw.offline();
    const res = await sw.dispatch("/library", {}, "navigate");
    expect(await res!.text()).toBe("old build");
  });
});
