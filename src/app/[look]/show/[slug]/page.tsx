import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShowView } from "@/components/shows/ShowView";
import { showCatalog } from "@/lib/shows/load";
import { showMetadata } from "@/lib/shows/metadata";
import { topicCatalog } from "@/lib/topics/load";

/**
 * /show/<slug>: one broadcast, server-rendered (docs/show-pages.md).
 *
 * No page is built ahead of time. `generateStaticParams` returning nothing,
 * with `dynamicParams` left on, makes each page render on its first request
 * and then serve from Next's cache until the next deploy: 1,413 pages are not
 * rendered on every build, and none is rendered twice.
 */
export const dynamicParams = true;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const show = showCatalog().bySlug.get(slug);
  return show ? showMetadata(show) : {};
}

export default async function ShowPage({ params }: Props) {
  const { slug } = await params;
  const catalog = showCatalog();
  const show = catalog.bySlug.get(slug);
  if (!show) notFound();
  return <ShowView show={show} catalog={catalog} topics={topicCatalog().byShow.get(slug) ?? []} />;
}
