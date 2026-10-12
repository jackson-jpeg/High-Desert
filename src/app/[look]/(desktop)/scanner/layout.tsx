import type { Metadata } from "next";

/*
 * Title is the bare page name: the root layout applies the template
 * "%s | High Desert", so "High Desert — Scanner" rendered as
 * "High Desert — Scanner | High Desert".
 *
 * The canonical is set per route. The root layout declares one pointing at the
 * homepage and Next inherits it, so every page was telling Google to drop it in
 * favour of "/" — directly contradicting sitemap.ts, which asks for these exact
 * URLs to be indexed.
 */
export const metadata: Metadata = {
  title: "Scanner",
  description: "Scan local audio files into the High Desert library.",
  alternates: { canonical: "/scanner" },
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
