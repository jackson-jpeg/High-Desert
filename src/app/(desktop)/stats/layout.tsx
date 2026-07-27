import type { Metadata } from "next";

/*
 * Title is the bare page name: the root layout applies the template
 * "%s | High Desert", so "High Desert — Stats" rendered as
 * "High Desert — Stats | High Desert".
 *
 * The canonical is set per route. The root layout declares one pointing at the
 * homepage and Next inherits it, so every page was telling Google to drop it in
 * favour of "/" — directly contradicting sitemap.ts, which asks for these exact
 * URLs to be indexed.
 */
export const metadata: Metadata = {
  title: "Stats",
  description: "Live listener count and traffic history for the High Desert Art Bell archive, plus your own listening statistics.",
  alternates: { canonical: "/stats" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
