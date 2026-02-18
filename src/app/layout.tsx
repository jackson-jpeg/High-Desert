import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import "./globals.css";

const w95fa = localFont({
  src: "../../public/fonts/W95FA.woff2",
  variable: "--font-w95",
  display: "swap",
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0A0E1A",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://highdesert.app"),
  title: {
    default: "High Desert — Art Bell Radio Archive",
    template: "%s | High Desert",
  },
  description: "Art Bell Radio Archive — Late night talk radio from the Kingdom of Nye. Stream thousands of Coast to Coast AM, Dreamland, and special episodes.",
  keywords: [
    "Art Bell", "Coast to Coast AM", "Dreamland", "radio archive", "paranormal",
    "UFO", "late night radio", "Kingdom of Nye", "talk radio", "streaming",
  ],
  manifest: "/manifest.json",
  alternates: {
    canonical: "https://highdesert.app",
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
    title: "High Desert — Art Bell Radio Archive",
    description: "Stream thousands of Art Bell episodes — Coast to Coast AM, Dreamland, and more from the Kingdom of Nye.",
    siteName: "High Desert",
    locale: "en_US",
    type: "website",
    url: "https://highdesert.app",
  },
  twitter: {
    card: "summary_large_image",
    title: "High Desert — Art Bell Radio Archive",
    description: "Stream thousands of Art Bell episodes — Coast to Coast AM, Dreamland, and more from the Kingdom of Nye.",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "High Desert",
  url: "https://highdesert.app",
  description: "Art Bell Radio Archive — Stream thousands of Coast to Coast AM, Dreamland, and special episodes.",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
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
                position: fixed; inset: 0; background: #0A0E1A;
                display: flex; align-items: center; justify-content: center;
                z-index: 9999; transition: opacity 0.4s ease;
              }
              #app-loading .boot-line {
                font-family: W95FA, monospace; font-size: 11px; color: #33FF33;
                text-shadow: 0 0 6px rgba(51,255,51,0.3);
                opacity: 0; white-space: nowrap;
              }
              #app-loading .boot-line.visible { opacity: 1; }
              #app-loading .boot-title {
                font-family: W95FA, monospace; font-size: 20px; font-weight: bold;
                color: #D4A843; letter-spacing: 3px; opacity: 0;
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
                color: #D4A843; font-family: W95FA, monospace;
                font-size: 16px; font-weight: bold; letter-spacing: 2px;
                text-shadow: 0 0 8px rgba(212,168,67,0.3);
              }
              #app-loading .quick-splash .sub {
                color: #808080; font-family: W95FA, monospace;
                font-size: 10px; margin-top: 8px;
              }
            `,
          }}
        />
        <div id="app-loading">
          <div id="boot-container" style={{ display: "none", flexDirection: "column", gap: "4px", padding: "40px" }}>
            <div className="boot-scanlines" />
            <div className="boot-line" data-boot="0">BIOS v1.0 — HIGH DESERT SYSTEMS</div>
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
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var isFirstVisit = !localStorage.getItem('hd-booted');
                var bootContainer = document.getElementById('boot-container');
                var quickSplash = document.getElementById('quick-splash');

                if (isFirstVisit && bootContainer) {
                  bootContainer.style.display = 'flex';
                  var lines = bootContainer.querySelectorAll('[data-boot]');
                  var delay = 0;
                  for (var i = 0; i < lines.length; i++) {
                    (function(el, d) {
                      setTimeout(function() { el.classList.add('visible'); }, d);
                    })(lines[i], delay);
                    delay += (i === lines.length - 1) ? 400 : 220;
                  }
                  localStorage.setItem('hd-booted', '1');
                } else if (quickSplash) {
                  quickSplash.style.display = 'block';
                }

                // Hide loading screen once React hydrates
                var observer = new MutationObserver(function() {
                  var el = document.getElementById('app-loading');
                  if (el && document.querySelector('[data-hydrated]')) {
                    var minDelay = isFirstVisit ? 2800 : 0;
                    var elapsed = performance.now();
                    var remaining = Math.max(0, minDelay - elapsed);
                    setTimeout(function() {
                      el.style.opacity = '0';
                      setTimeout(function() { if (el) el.style.display = 'none'; }, 400);
                    }, remaining);
                    observer.disconnect();
                  }
                });
                observer.observe(document.body, { childList: true, subtree: true });
                setTimeout(function() {
                  var el = document.getElementById('app-loading');
                  if (el) { el.style.opacity = '0'; setTimeout(function() { if (el) el.style.display = 'none'; }, 400); }
                }, 6000);
              })();
            `,
          }}
        />
        <ServiceWorkerRegistration />
        {children}
      </body>
    </html>
  );
}
