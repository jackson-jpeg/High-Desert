import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ShowList } from "@/components/shows/ShowView";
import { showCatalog } from "@/lib/shows/load";
import { guestMetadata } from "@/lib/shows/metadata";
import { breadcrumbJsonLd, guestCrumbs, guestDescription, guestJsonLd, jsonLdScript } from "@/lib/shows/jsonld";
import { libraryIntentHref } from "@/lib/library/intents";

/**
 * /guest/<slug>: every show with one guest (docs/show-pages.md), for a search
 * by name. Only guests with two or more shows have one (GUEST_PAGE_MIN); a
 * single show is that show's own page. Rendered on first request, like show
 * pages.
 */
export const dynamicParams = true;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const guest = showCatalog().guests.get(slug);
  return guest ? guestMetadata(guest) : {};
}

export default async function GuestPage({ params }: Props) {
  const { slug } = await params;
  const guest = showCatalog().guests.get(slug);
  if (!guest) notFound();
  const crumbs = guestCrumbs(guest);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(guestJsonLd(guest)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(breadcrumbJsonLd(crumbs)) }} />
      <nav aria-label="Breadcrumb" className="hd-show-crumbs text-hd-caption text-bevel-dark mb-3">
        <ol className="flex flex-wrap items-center gap-1">
          {crumbs.slice(0, -1).map((c) => (
            <li key={c.name} className="flex items-center gap-1">
              <Link href={c.path!} className="text-signal-blue hover:text-desktop-gray">
                {c.name}
              </Link>
              <span aria-hidden="true">›</span>
            </li>
          ))}
          <li aria-current="page">{guest.name}</li>
        </ol>
      </nav>
      <article className="hd-show-article hd-show-guest w98-raised-dark bg-raised-surface p-4 md:p-6">
        <p className="hd-show-series text-hd-caption uppercase tracking-wider text-desert-amber mb-1">Guest</p>
        <h1 className="hd-show-title w98-font text-hd-h2 text-desktop-gray leading-tight">{guest.name}</h1>
        <p className="hd-show-meta text-hd-body text-desktop-gray mt-3">{guestDescription(guest)}</p>
        <div className="mt-4">
          <Link
            href={libraryIntentHref({ q: guest.name })}
            className="hd-show-open w98-raised-dark bg-raised-surface w98-font text-hd-body text-desktop-gray hover:text-desert-amber px-4 min-h-touch inline-flex items-center"
          >
            Search the library
          </Link>
        </div>
      </article>
      <section className="hd-show-related mt-8" aria-labelledby="hd-guest-shows">
        <h2 id="hd-guest-shows" className="hd-show-related-title w98-font text-hd-title text-desert-amber mb-1">
          Shows with {guest.name}
        </h2>
        <ShowList shows={guest.shows} />
      </section>
    </>
  );
}
