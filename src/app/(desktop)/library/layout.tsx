import type { Metadata } from "next";
import { RouteHeading } from "@/components/desktop/RouteHeading";

/*
 * Title is the bare page name: the root layout applies the template
 * "%s | High Desert", so "High Desert — Library" rendered as
 * "High Desert — Library | High Desert".
 *
 * The canonical is set per route. The root layout declares one pointing at the
 * homepage and Next inherits it, so every page was telling Google to drop it in
 * favour of "/" — directly contradicting sitemap.ts, which asks for these exact
 * URLs to be indexed.
 */
export const metadata: Metadata = {
  title: "Library",
  description: "Browse the full Art Bell archive. Search thousands of Coast to Coast AM, Dreamland and special episodes by guest, topic, series or air date.",
  alternates: { canonical: "/library" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RouteHeading>Library</RouteHeading>
      {children}
    </>
  );
}
