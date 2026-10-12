import { readFileSync } from "node:fs";
import path from "node:path";
import { buildShowCatalog, type ShowCatalog } from "@/lib/shows/catalog";
import type { CatalogRow } from "@/lib/shows/describe";

/**
 * The show catalog for server code (pages, share images, the sitemap), read
 * off disk once per process. Deliberately not an `import` of the JSON: the
 * seed is ~2 MB and would be inlined into every bundle that touches a show
 * (the same reasoning as src/services/stats/catalog.ts).
 */

let cached: ShowCatalog | null = null;

export function readCatalogFiles(root = process.cwd()): { rows: CatalogRow[]; slugs: Record<string, string> } {
  const rows = JSON.parse(readFileSync(path.join(root, "public", "seed", "library.json"), "utf8")) as CatalogRow[];
  const slugs = JSON.parse(readFileSync(path.join(root, "data", "show-slugs.json"), "utf8")) as Record<string, string>;
  return { rows, slugs };
}

export function showCatalog(): ShowCatalog {
  if (!cached) {
    const { rows, slugs } = readCatalogFiles();
    cached = buildShowCatalog(rows, slugs);
  }
  return cached;
}
