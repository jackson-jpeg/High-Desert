import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { TopicView } from "@/components/topics/TopicView";
import { topicCatalog } from "@/lib/topics/load";
import { topicMetadata } from "@/lib/shows/metadata";

/**
 * /topic/<slug>: every show about one subject (docs/show-pages.md, "Topic
 * pages"), for a search like "Art Bell Area 51". Which topics exist, and the
 * rule, is src/lib/topics/rules.ts; slugs are permanent (data/topic-slugs.json).
 * Rendered on first request and cached until the next deploy, like show pages.
 */
export const dynamicParams = true;

export function generateStaticParams(): { slug: string }[] {
  return [];
}

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const topic = topicCatalog().bySlug.get(slug);
  return topic ? topicMetadata(topic) : {};
}

export default async function TopicPage({ params }: Props) {
  const { slug } = await params;
  const tc = topicCatalog();
  const topic = tc.bySlug.get(slug);
  if (!topic) notFound();
  return <TopicView topic={topic} catalog={tc} />;
}
