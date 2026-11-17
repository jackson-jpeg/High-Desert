import type { Metadata } from "next";
import { ShowsIndex } from "@/components/shows/ShowsArchive";
import { showCatalog } from "@/lib/shows/load";
import { showYears } from "@/lib/shows/archive";
import { SITE_NAME } from "@/lib/shows/describe";

/** /shows: every year of the archive (docs/show-pages.md, "The archive by year"). Static. */

const TITLE = "Every Art Bell show, by year";
const DESCRIPTION =
  "Every Art Bell radio show in the archive, by the year it aired: Coast to Coast AM, Dreamland and the specials, free to play on High Desert.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/shows" },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: "/shows",
    siteName: SITE_NAME,
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "High Desert: the Art Bell radio archive" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/twitter-image"] },
};

export default function ShowsPage() {
  return <ShowsIndex years={showYears(showCatalog())} />;
}
