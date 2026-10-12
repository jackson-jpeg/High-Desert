import { readFileSync } from "node:fs";
import path from "node:path";
import { showCatalog } from "@/lib/shows/load";
import { buildTopicCatalog, type TopicCatalog } from "@/lib/topics/catalog";

/** The topic catalog for server code, built once per process (like src/lib/shows/load.ts). */

let cached: TopicCatalog | null = null;

export function readTopicSlugs(root = process.cwd()): Record<string, string> {
  return JSON.parse(readFileSync(path.join(root, "data", "topic-slugs.json"), "utf8")) as Record<string, string>;
}

export function topicCatalog(): TopicCatalog {
  if (!cached) cached = buildTopicCatalog(showCatalog(), readTopicSlugs());
  return cached;
}
