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
  title: "High Desert",
  description: "Art Bell Radio Archive",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "High Desert",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${w95fa.variable} bg-midnight antialiased`}>
        {children}
      </body>
    </html>
  );
}
