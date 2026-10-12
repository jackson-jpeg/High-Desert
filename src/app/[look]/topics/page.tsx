import type { Metadata } from "next";
import { TopicsIndex } from "@/components/topics/TopicView";
import { topicCatalog } from "@/lib/topics/load";
import { SITE_NAME } from "@/lib/shows/describe";

/** /topics: every topic page, grouped (docs/show-pages.md, "Topic pages"). Static. */

const TITLE = "Art Bell shows by topic";
const DESCRIPTION =
  "UFOs, Area 51, remote viewing, Mel's Hole, ghosts and more: every topic in the archive of Art Bell's radio shows, free to play on High Desert.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/topics" },
  openGraph: {
    type: "website",
    title: TITLE,
    description: DESCRIPTION,
    url: "/topics",
    siteName: SITE_NAME,
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "High Desert: the Art Bell radio archive" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/twitter-image"] },
};

export default function TopicsPage() {
  return <TopicsIndex catalog={topicCatalog()} />;
}
