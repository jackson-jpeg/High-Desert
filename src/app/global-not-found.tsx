import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

/**
 * The 404 for a URL outside every look (src/app/[look]/ is the root layout,
 * so nothing else can frame it): a request the proxy does not rewrite, such
 * as an unknown file. Drawn plainly, in the default look's gray.
 */
export const metadata: Metadata = {
  title: "Not found | High Desert",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="en" data-look="win98">
      <body className="min-h-screen flex items-center justify-center p-4">
        <main className="hd-global-404 text-center">
          <h1 className="text-hd-h2 font-bold mb-2">Signal lost</h1>
          <p className="text-hd-body mb-4">There is nothing at this address.</p>
          <Link href="/" className="underline">Go to High Desert</Link>
        </main>
      </body>
    </html>
  );
}
