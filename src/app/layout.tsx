import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${w95fa.variable} bg-midnight antialiased`}>
        {children}
      </body>
    </html>
  );
}
