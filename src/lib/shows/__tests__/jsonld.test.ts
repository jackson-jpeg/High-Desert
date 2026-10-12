// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readCatalogFiles } from "@/lib/shows/load";
import { buildShowCatalog } from "@/lib/shows/catalog";
import {
  breadcrumbJsonLd,
  episodeJsonLd,
  guestCrumbs,
  guestJsonLd,
  jsonLdScript,
  showCrumbs,
} from "@/lib/shows/jsonld";
import { showMetadata, guestMetadata } from "@/lib/shows/metadata";
import { siteVerification } from "@/lib/seo/verification";
import { validateJsonLd } from "../../../../scripts/lib/jsonld-check.mjs";

/**
 * Structured data and <head> for show and guest pages (docs/show-pages.md),
 * held to the schema.org vocabulary by scripts/lib/jsonld-check.mjs, which
 * seo-check.mjs runs again on the served pages.
 */

const { rows, slugs } = readCatalogFiles();
const catalog = buildShowCatalog(rows, slugs);
const area51 = catalog.bySlug.get("1992-12-12-area-51-john-lear-bob-lazar")!;
/** A JSON-LD node as data to poke at: what a crawler parses. */
const plain = (node: unknown) => JSON.parse(JSON.stringify(node));

describe("episodeJsonLd", () => {
  it("describes a broadcast as a PodcastEpisode of its programme", () => {
    const ld = plain(episodeJsonLd(area51, catalog));
    expect(ld["@type"]).toBe("PodcastEpisode");
    expect(ld.url).toBe("https://highdesert.space/show/1992-12-12-area-51-john-lear-bob-lazar");
    expect(ld.name).toBe("Area 51 with John Lear and Bob Lazar");
    expect(ld.datePublished).toBe("1992-12-12");
    expect(ld.duration).toBe("PT2H9M58S");
    expect(ld.partOfSeries).toMatchObject({ "@type": "PodcastSeries", name: "Coast to Coast AM with Art Bell" });
    expect(ld.creator).toMatchObject({ "@type": "Person", name: "Art Bell" });
    expect(ld.actor.map((p: { name: string }) => p.name)).toEqual(["John Lear", "Bob Lazar"]);
    expect(ld.associatedMedia).toMatchObject({
      "@type": "AudioObject",
      contentUrl: area51.row.sourceUrl,
      encodingFormat: "audio/mpeg",
    });
    expect(ld.image).toBe("https://highdesert.space/show/1992-12-12-area-51-john-lear-bob-lazar/opengraph-image");
  });

  it("is valid schema.org for every show in the catalog", () => {
    for (const show of catalog.shows) {
      expect(validateJsonLd(episodeJsonLd(show, catalog)), show.slug).toEqual([]);
      expect(validateJsonLd(breadcrumbJsonLd(showCrumbs(show))), show.slug).toEqual([]);
    }
  });

  it("links a guest who has a guest page, and only them", () => {
    for (const show of catalog.shows) {
      const actors = (plain(episodeJsonLd(show, catalog)).actor ?? []) as { url?: string }[];
      for (const a of actors) {
        if (!a.url) continue;
        const slug = a.url.replace("https://highdesert.space/guest/", "");
        expect(catalog.guests.has(slug), a.url).toBe(true);
      }
    }
  });

  it("cannot be closed early by a </script> in the data", () => {
    expect(jsonLdScript({ name: "</script><script>alert(1)</script>" })).not.toContain("</script>");
  });
});

describe("guest pages' structured data", () => {
  it("is valid for every guest", () => {
    for (const g of catalog.guests.values()) {
      expect(validateJsonLd(guestJsonLd(g)), g.slug).toEqual([]);
      expect(validateJsonLd(breadcrumbJsonLd(guestCrumbs(g))), g.slug).toEqual([]);
    }
  });
});

describe("validateJsonLd catches what Google would reject", () => {
  const good = () => plain(episodeJsonLd(area51, catalog));

  it("passes the real thing", () => {
    expect(validateJsonLd(good())).toEqual([]);
  });

  it("a property the type does not have", () => {
    expect(validateJsonLd({ ...good(), host: "Art Bell" }).join()).toMatch(/no property "host"/);
  });

  it("a missing required property", () => {
    const ld = good();
    delete ld.datePublished;
    expect(validateJsonLd(ld).join()).toMatch(/missing "datePublished"/);
  });

  it("a malformed date, duration or URL", () => {
    expect(validateJsonLd({ ...good(), datePublished: "12/12/1992" }).join()).toMatch(/datePublished: invalid/);
    expect(validateJsonLd({ ...good(), duration: "2:09:58" }).join()).toMatch(/duration: malformed/);
    expect(validateJsonLd({ ...good(), url: "/show/x" }).join()).toMatch(/url: malformed/);
  });

  it("a nested node that is wrong, and a type it does not know", () => {
    const ld = good();
    ld.associatedMedia.encodingFormat = "audio/wav";
    expect(validateJsonLd(ld).join()).toMatch(/associatedMedia\.encodingFormat: invalid/);
    expect(validateJsonLd({ "@context": "https://schema.org", "@type": "RadioEpisodeX", name: "x" }).join()).toMatch(/not one this check knows/);
  });

  it("a breadcrumb out of order or without a target", () => {
    const bc = plain(breadcrumbJsonLd(showCrumbs(area51)));
    bc.itemListElement[1].position = 5;
    expect(validateJsonLd(bc).join()).toMatch(/itemListElement: invalid/);
    const bc2 = breadcrumbJsonLd([{ name: "Home" }, { name: "Here" }]);
    expect(validateJsonLd(bc2).join()).toMatch(/itemListElement: invalid/);
  });
});

describe("showMetadata", () => {
  it("has the title, description, canonical, Open Graph and Twitter card", () => {
    const m = showMetadata(area51);
    expect(m.title).toBe("Area 51 with John Lear and Bob Lazar · Coast to Coast AM, December 12, 1992");
    expect(m.description).toMatch(/^Coast to Coast AM with Art Bell, December 12, 1992\./);
    expect(m.alternates?.canonical).toBe("/show/1992-12-12-area-51-john-lear-bob-lazar");
    expect(m.openGraph).toMatchObject({
      title: m.title,
      description: m.description,
      url: "/show/1992-12-12-area-51-john-lear-bob-lazar",
      siteName: "High Desert",
    });
    expect(m.twitter).toMatchObject({ card: "summary_large_image", title: m.title });
  });

  it("guest pages too", () => {
    const g = catalog.guests.get("linda-moulton-howe")!;
    const m = guestMetadata(g);
    expect(m.alternates?.canonical).toBe("/guest/linda-moulton-howe");
    expect(m.title).toMatch(/^Linda Moulton Howe on Art Bell · \d+ shows$/);
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });
});

describe("siteVerification (GOOGLE_SITE_VERIFICATION)", () => {
  it("absent, empty or malformed is no tag", () => {
    expect(siteVerification({})).toBeUndefined();
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: "" })).toBeUndefined();
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: '"><script>' })).toBeUndefined();
  });

  it("a token is the google verification, quoted or not", () => {
    const token = "AbC-123_xyzTOKENvalue0987654321abcdefghijk";
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: token })).toEqual({ google: token });
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: `"${token}"` })).toEqual({ google: token });
  });
});
