import type { Metadata } from "next";

/*
 * /radio had no layout, so it inherited the root title and the root canonical
 * pointing at "/" — it was in sitemap.ts asking to be indexed while its own
 * head told Google to drop it.
 */
export const metadata: Metadata = {
  title: "Radio Dial",
  description:
    "Tune through the Art Bell archive chronologically on an AM dial. Scan the band, lock onto a broadcast and listen.",
  alternates: { canonical: "/radio" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
