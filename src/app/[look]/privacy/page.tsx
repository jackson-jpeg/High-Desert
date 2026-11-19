import type { Metadata } from "next";
import { PrivacyView } from "@/components/privacy/PrivacyView";
import { PRIVACY_DESCRIPTION, PRIVACY_PATH, PRIVACY_TITLE } from "@/lib/privacy/policy";
import { SITE_NAME } from "@/lib/shows/describe";

/** /privacy: what the site keeps (docs/privacy.md). Static. */

const TITLE = `${PRIVACY_TITLE} policy`;

export const metadata: Metadata = {
  title: TITLE,
  description: PRIVACY_DESCRIPTION,
  alternates: { canonical: PRIVACY_PATH },
  openGraph: {
    type: "website",
    title: TITLE,
    description: PRIVACY_DESCRIPTION,
    url: PRIVACY_PATH,
    siteName: SITE_NAME,
    locale: "en_US",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "High Desert: the Art Bell radio archive" }],
  },
  twitter: { card: "summary_large_image", title: TITLE, description: PRIVACY_DESCRIPTION, images: ["/twitter-image"] },
};

export default function PrivacyPage() {
  return <PrivacyView />;
}
