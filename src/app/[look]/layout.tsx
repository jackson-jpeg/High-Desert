import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { LookProvider } from "@/hooks/useLook";
import { isLook, LOOKS, lookFrom } from "@/lib/look/look";
import { notFound } from "next/navigation";
import { UsageTracker } from "@/components/UsageTracker";
import { BOOT_SCRIPT } from "../boot-script";
import { SEASON_SCRIPT } from "@/lib/season/season";
import { HalloweenScene } from "@/components/desktop/HalloweenScene";
import { PALETTE } from "@/lib/palette";
import { BUILD_META } from "@/lib/utils/build-id";
import { siteVerification } from "@/lib/seo/verification";
import "../globals.css";

const w95fa = localFont({
  src: "../../../public/fonts/W95FA.woff2",
  variable: "--font-w95",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  themeColor: PALETTE.midnight, // a meta tag: the browser chrome reads it, not CSS
};

export const metadata: Metadata = {
  metadataBase: new URL("https://highdesert.space"),
  title: {
    default: "High Desert · Art Bell Radio Archive",
    template: "%s | High Desert",
  },
  description: "Art Bell Radio Archive. Late night talk radio from the Kingdom of Nye. Stream thousands of Coast to Coast AM, Dreamland, and special episodes.",
  keywords: [
    "Art Bell", "Coast to Coast AM", "Dreamland", "radio archive", "paranormal",
    "UFO", "late night radio", "Kingdom of Nye", "talk radio", "streaming",
  ],
  manifest: "/manifest.json",
  // Search Console's meta tag, only when GOOGLE_SITE_VERIFICATION is set at build.
  verification: siteVerification(),
  // Root canonical only. Child layouts override it per route — Next inherits
  // this value otherwise, which had every page pointing at "/".
  alternates: {
    canonical: "/",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "High Desert",
  },
  openGraph: {
    title: "High Desert · Art Bell Radio Archive",
    description: "Stream thousands of Art Bell episodes: Coast to Coast AM, Dreamland, and more from the Kingdom of Nye.",
    siteName: "High Desert",
    locale: "en_US",
    type: "website",
    url: "https://highdesert.space",
    // Named, not inherited: the card (src/app/opengraph-image.tsx) sits
    // outside the look segment so its URL carries no look, and Next adds a
    // card by itself only to pages in its own segment.
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "High Desert: the Art Bell radio archive" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "High Desert · Art Bell Radio Archive",
    description: "Stream thousands of Art Bell episodes: Coast to Coast AM, Dreamland, and more from the Kingdom of Nye.",
    images: ["/twitter-image"],
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "High Desert",
  url: "https://highdesert.space",
  description: "Art Bell Radio Archive. Stream thousands of Coast to Coast AM, Dreamland, and special episodes.",
  applicationCategory: "MultimediaApplication",
  operatingSystem: "Any",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
  },
  about: {
    "@type": "Person",
    name: "Art Bell",
    birthDate: "1945-06-17",
    deathDate: "2018-04-13",
    description: "American broadcaster and author, known for Coast to Coast AM.",
  },
};

/**
 * The root layout, once per look (src/lib/look/look.ts): src/proxy.ts rewrites
 * every page request into `/<look>/...`, and both looks are prerendered.
 */
/**
 * Not `dynamicParams = false`: on the root segment that also refuses every
 * page rendered on demand below it (a show, a guest). An unknown look is
 * refused here instead, though only a request that skipped the rewrite (a
 * file name, say) can bring one.
 */

export function generateStaticParams(): { look: string }[] {
  return LOOKS.map((look) => ({ look }));
}

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ look: string }>;
}>) {
  const asked = (await params).look;
  if (!isLook(asked)) notFound();
  const look = lookFrom(asked);
  return (
    // suppressHydrationWarning: SEASON_SCRIPT adds data-season to <html>
    // before React hydrates (this element only; children are still checked).
    <html lang="en" data-look={look} suppressHydrationWarning>
      <head>
        {/* The holiday season, from the visitor's own date, before first paint (docs/seasons.md). */}
        <script dangerouslySetInnerHTML={{ __html: SEASON_SCRIPT }} />
        {/* The build this document belongs to (src/lib/utils/build-id.ts). */}
        <meta name={BUILD_META} content={process.env.NEXT_PUBLIC_BUILD_ID ?? "dev"} />
        <link rel="preconnect" href="https://archive.org" />
        <link rel="dns-prefetch" href="https://archive.org" />
        <link rel="preconnect" href="https://ia800100.us.archive.org" crossOrigin="anonymous" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${w95fa.variable} bg-midnight antialiased`}>
        {/* Inline loading screen — CRT boot sequence on first visit, quick splash on return */}
        <style
          dangerouslySetInnerHTML={{
            __html: `
              #app-loading {
                position: fixed; inset: 0; background: ${PALETTE.midnight};
                display: flex; align-items: center; justify-content: center;
                z-index: 9999; transition: opacity 0.4s ease;
              }
              #app-loading .boot-line {
                font-family: var(--font-w95, monospace); font-size: 11px; color: ${PALETTE.greenBright};
                text-shadow: 0 0 6px rgba(51,255,51,0.3);
                opacity: 0; white-space: nowrap;
              }
              #app-loading .boot-line.visible { opacity: 1; }
              #app-loading .boot-title {
                font-family: var(--font-w95, monospace); font-size: 20px; font-weight: bold;
                color: ${PALETTE.amber}; letter-spacing: 3px; opacity: 0;
                text-shadow: 0 0 12px rgba(212,168,67,0.4);
              }
              #app-loading .boot-title.visible { opacity: 1; }
              #app-loading .boot-scanlines {
                position: absolute; inset: 0; pointer-events: none;
                background: repeating-linear-gradient(
                  0deg, transparent, transparent 2px,
                  rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px
                );
              }
              #app-loading .quick-splash {
                text-align: center;
              }
              #app-loading .quick-splash .title {
                color: ${PALETTE.amber}; font-family: var(--font-w95, monospace);
                font-size: 16px; font-weight: bold; letter-spacing: 2px;
                text-shadow: 0 0 8px rgba(212,168,67,0.3);
              }
              #app-loading .quick-splash .sub {
                color: ${PALETTE.muted}; font-family: var(--font-w95, monospace);
                font-size: 11px; margin-top: 8px;
              }
            `,
          }}
        />
        <div id="app-loading">
          <div id="boot-container" style={{ display: "none", flexDirection: "column", gap: "4px", padding: "40px" }}>
            <div className="boot-scanlines" />
            <div className="boot-line" data-boot="0">BIOS v1.0 · HIGH DESERT SYSTEMS</div>
            <div className="boot-line" data-boot="1">MEMORY TEST... 640K OK</div>
            <div className="boot-line" data-boot="2">SYSTEM CHECK... OK</div>
            <div className="boot-line" data-boot="3">LOADING ARCHIVE.ORG INTERFACE...</div>
            <div className="boot-line" data-boot="4">INITIALIZING RADIO DIAL...</div>
            <div className="boot-line" data-boot="5">CONNECTING TO KINGDOM OF NYE...</div>
            <div className="boot-line" data-boot="6">SIGNAL ACQUIRED ████████████ 100%</div>
            <div className="boot-line" data-boot="7" style={{ height: "12px" }}></div>
            <div className="boot-title" data-boot="8">HIGH DESERT</div>
          </div>
          <div id="quick-splash" style={{ display: "none" }}>
            <div className="quick-splash">
              <div className="title">HIGH DESERT</div>
              <div className="sub">Loading...</div>
            </div>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
        <LookProvider look={look}>
          <ServiceWorkerRegistration />
          <UsageTracker />
          {/* Halloween's moon and jack-o'-lantern, on the desktop behind every page (docs/seasons.md). */}
          <HalloweenScene />
          {children}
        </LookProvider>
      </body>
    </html>
  );
}
