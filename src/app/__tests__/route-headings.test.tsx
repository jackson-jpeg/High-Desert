import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, createElement, type ComponentType, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Every route has exactly one <h1> (HD-021 follow-up; axe `page-has-heading-one`).
 *
 * /library, /radio and /stats had none: the Win98 shell names nothing, it
 * draws title bars and tabs. /stats had one only while loading or empty —
 * its placeholder window was an h1, and the populated page was not.
 *
 * Each route is rendered the way Next composes it — the route's real
 * layout.tsx around its real page.tsx — rather than asserting on the heading
 * component in isolation, because the failure this guards against is
 * compositional: a page that grows its own h1 under a layout that already has
 * one, or a route whose layout forgot it. The route list is read from the
 * filesystem, so a new route with no h1 fails here without anyone having to
 * remember to add it. e2e/a11y.spec.ts checks the same thing in a real browser.
 *
 * Counted after every pending effect and IndexedDB read has settled, and
 * twice — in the page's first frame and once it has loaded — since /stats's
 * two states render different trees.
 */

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
} as unknown as typeof IntersectionObserver;
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

let pathname = "/";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));
// Canvas and requestAnimationFrame loops; they draw, they do not name the page.
vi.mock("@/components/desktop/Starfield", () => ({ Starfield: () => null }));
// The network: stats reads resolve empty rather than hang.
vi.stubGlobal(
  "fetch",
  vi.fn(async () => new Response("{}", { status: 503, headers: { "content-type": "application/json" } })),
);

const { useAdminStore } = await import("@/stores/admin-store");
const { db } = await import("@/db");
const { toEpisodeRow } = await import("@/db/seed");
const catalog = (await import("../../../public/seed/library.json")).default as Record<string, unknown>[];

// A few real catalog rows, so /stats and /library reach their populated trees.
// With an empty database /stats only ever shows its empty-state window, which
// is the one state that already had an h1.
await db.episodes.bulkAdd(catalog.slice(0, 5).map((r) => toEpisodeRow(r, Date.now())) as never[]);

const DESKTOP = path.resolve(import.meta.dirname, "../(desktop)");
const ROUTES = readdirSync(DESKTOP).filter((d) => statSync(path.join(DESKTOP, d)).isDirectory());

/**
 * Text that proves a page got past its loading frame, where a page has one.
 * Without it, "settled" could be the loading state counted twice.
 */
const LOADED: Record<string, string> = {
  stats: "Your Listening",
  radio: "Jump to year",
};

/** Admin-only pages render nothing for a visitor (and redirect). Their h1 is checked as an admin. */
const ADMIN_ONLY = new Set(["scanner", "search"]);

type LayoutComponent = ComponentType<{ children: ReactNode }>;

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useAdminStore.setState({ isAdmin: false });
});

async function settle() {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

function h1s(): string[] {
  return [...container.querySelectorAll("h1")].map((h) => h.textContent?.trim() ?? "");
}

describe("every route has exactly one h1", () => {
  it("finds the routes on disk (a glob that matched nothing would pass every case below)", () => {
    expect(ROUTES).toEqual(expect.arrayContaining(["library", "radio", "scanner", "search", "stats"]));
  });

  // Importing /library compiles most of the app on a cold cache.
  it.each(ROUTES)("/%s", { timeout: 60_000 }, async (route) => {
    const { default: Layout } = (await import(`../(desktop)/${route}/layout.tsx`)) as { default: LayoutComponent };
    const { default: Page } = (await import(`../(desktop)/${route}/page.tsx`)) as { default: ComponentType };
    pathname = `/${route}`;
    if (ADMIN_ONLY.has(route)) useAdminStore.setState({ isAdmin: true });

    act(() => {
      root.render(createElement(Layout, null, createElement(Page)));
    });
    const first = h1s();
    expect(first, `/${route}, first frame`).toHaveLength(1);
    expect(first[0]).not.toBe("");

    await settle();
    if (LOADED[route]) {
      await expect.poll(() => container.innerHTML, { timeout: 20_000 }).toContain(LOADED[route]);
    }
    const loaded = h1s();
    expect(loaded, `/${route}, settled`).toHaveLength(1);
    expect(first[0], "the same heading in both states").toBe(loaded[0]);
    expect(loaded[0]).not.toBe("");
  });

  it("/ (the welcome page)", async () => {
    const { default: Page } = await import("../page");
    pathname = "/";
    act(() => {
      root.render(createElement(Page));
    });
    await settle();
    expect(h1s()).toEqual(["HIGH DESERT"]);
  });

  it("the 404 page", async () => {
    const { default: NotFound } = await import("../not-found");
    act(() => {
      root.render(createElement(NotFound));
    });
    expect(h1s()).toEqual(["Signal Lost"]);
  });

  it("both error boundaries", async () => {
    const error = Object.assign(new Error("boom"), { digest: "d1" });
    for (const [mod, heading] of [
      [await import("../error"), "We’re experiencing technical difficulties"],
      [await import("../(desktop)/error"), "This page encountered an error"],
    ] as const) {
      act(() => {
        root.render(createElement(mod.default, { error, reset: () => {} }));
      });
      expect(h1s().map((t) => t.replace("'", "’"))).toEqual([heading]);
    }
  });

  it("the global error page (renders its own <html>, so as markup)", async () => {
    const { default: GlobalError } = await import("../global-error");
    const html = renderToStaticMarkup(createElement(GlobalError, { error: new Error("boom"), reset: () => {} }));
    expect(html.match(/<h1[\s>]/g) ?? []).toHaveLength(1);
    expect(html).toMatch(/<h1[^>]*>\s*The signal dropped out entirely.\s*<\/h1>/);
  });
});
