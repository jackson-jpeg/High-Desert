import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowsYearView } from "@/components/shows/ShowsArchive";
import { showCatalog } from "@/lib/shows/load";
import { showYear, showsYearPath } from "@/lib/shows/archive";
import { SITE_NAME } from "@/lib/shows/describe";

/**
 * /shows/<year>: every show that aired that year (docs/show-pages.md, "The
 * archive by year"). Rendered on first request and cached until the next
 * deploy, like the show pages; a year with no show is a 404.
 */
export const dynamicParams = true;

export function generateStaticParams(): { year: string }[] {
  return [];
}

type Props = { params: Promise<{ year: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { year } = await params;
  const found = showYear(showCatalog(), year);
  if (!found) return {};
  const n = found.year.shows.length;
  const title = `Art Bell shows from ${year}`;
  const description = n === 1
    ? `The one Art Bell radio show from ${year} in the archive, free to play on High Desert.`
    : `All ${n} Art Bell radio shows from ${year} in the archive, in the order they aired, free to play on High Desert.`;
  const path = showsYearPath(year);
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      title,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: "en_US",
      images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "High Desert: the Art Bell radio archive" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/twitter-image"] },
  };
}

export default async function ShowsYearPage({ params }: Props) {
  const { year } = await params;
  const found = showYear(showCatalog(), year);
  if (!found) notFound();
  return <ShowsYearView year={found.year} prev={found.prev} next={found.next} />;
}
