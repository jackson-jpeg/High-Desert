import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ShowShell } from "@/components/shows/ShowShell";
import { PrivacyView } from "@/components/privacy/PrivacyView";
import { DNT_SENTENCE, PRIVACY_EFFECTIVE, PRIVACY_PATH } from "@/lib/privacy/policy";
import sitemap from "@/app/sitemap";
import { validateJsonLd } from "../../../../scripts/lib/jsonld-check.mjs";

/**
 * The privacy page (/privacy, docs/privacy.md), asked for by the weekly site
 * check on sang3r.com, which fails a site whose home page HTML links no
 * privacy page, and by the 2026-11-16 privacy audit (CalOPPA: an effective
 * date and a Do Not Track line). Held here: the page's key facts in the server
 * HTML, no em dash, and the links to it in the HTML the server sends for `/`
 * and for every page in the show pages' frame.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/db", () => ({ db: { episodes: { count: async () => 0 } } }));

function parse(html: string): Document {
  return new DOMParser().parseFromString(`<!doctype html><html><head></head><body>${html}</body></html>`, "text/html");
}

const page = () => parse(renderToStaticMarkup(createElement(ShowShell, null, createElement(PrivacyView))));
const text = (d: Document) => (d.body.textContent ?? "").replace(/\s+/g, " ");

describe("the privacy page", () => {
  it("is server HTML with one h1, an effective date and the Do Not Track line", () => {
    const d = page();
    expect(d.querySelectorAll("h1")).toHaveLength(1);
    expect(d.querySelector("h1")?.textContent).toBe("Privacy");
    const time = d.querySelector('[data-testid="privacy-policy"] time');
    expect(time?.getAttribute("datetime")).toBe(PRIVACY_EFFECTIVE);
    expect(PRIVACY_EFFECTIVE).toBe("2026-11-19");
    expect(time?.parentElement?.textContent).toBe("Effective 19 November 2026");
    expect(text(d)).toContain(DNT_SENTENCE);
    expect(DNT_SENTENCE).toBe(
      "High Desert's own counting does not follow you to other sites and shares nothing with anyone, so the site treats every visitor the same way whether or not your browser sends a Do Not Track signal.",
    );
  });

  it("says what is kept, where and for how long", () => {
    const t = text(page());
    // In the browser: IndexedDB, and the visitor id by name.
    expect(t).toContain("kept in this browser's own database (IndexedDB), not on our server");
    expect(t).toContain("under the name hd-visitor. It is not a cookie.");
    expect(t).toContain("Your IP address is not kept with it.");
    // The cookies by name, the caller's set before calling in, 400 days.
    expect(t).toContain("hd_look remembers the look you chose (Win98 or Night) for up to 400 days.");
    expect(t).toContain("hd_live_caller is set when you open Live or the Request Line, before you call in.");
    expect(t).toContain("signed by our server and lasts 400 days");
    // The phone lines' retention and the server logs'.
    expect(t).toContain("Phone line messages are deleted after 7 days");
    expect(t).toContain("These logs are kept for 13 months and then deleted.");
    // The one outside party the browser talks to.
    expect(t).toContain("your browser usually fetches the audio straight from archive.org");
    expect(t).toContain("We do not sell or share what we keep.");
  });

  it("has no em dash anywhere (user-facing copy, /root/CLAUDE.md)", () => {
    expect(page().body.innerHTML).not.toMatch(/—/);
  });

  it("carries valid BreadcrumbList JSON-LD, as check:seo requires", () => {
    const blocks = [...page().querySelectorAll('script[type="application/ld+json"]')].map((s) => JSON.parse(s.textContent!));
    expect(blocks.map((b) => b["@type"])).toContain("BreadcrumbList");
    for (const b of blocks) expect(validateJsonLd(b)).toEqual([]);
  });

  it("is in the sitemap", () => {
    expect(sitemap().map((e) => new URL(e.url).pathname)).toContain(PRIVACY_PATH);
  });

  it("is linked from the footer of every page in the show pages' frame", () => {
    const d = parse(renderToStaticMarkup(createElement(ShowShell, null, createElement("p", null, "x"))));
    expect(d.querySelector('.hd-show-footer a[href="/privacy"]')?.textContent).toBe("Privacy");
  });

  it("is linked in the HTML the server sends for the home page, which the weekly site check reads", async () => {
    const { default: WelcomePage } = await import("@/app/[look]/page");
    const html = renderToStaticMarkup(createElement(WelcomePage));
    // sang3r.com's check (src/lib/sites/guard.ts): an href naming privacy in the raw HTML.
    expect(html).toMatch(/href="[^"]*privacy[^"]*"/i);
    expect(parse(html).querySelector('a[data-testid="welcome-privacy"]')?.getAttribute("href")).toBe("/privacy");
  });
});
