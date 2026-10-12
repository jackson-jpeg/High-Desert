import notable from "../../../data/notable.json";

/**
 * Why a show is one of the archive's notable broadcasts, from the cited list
 * in data/notable.json (rules: data/notable.md). Topic and Tonight pages lead
 * with these. Small (a few KB), so imported, unlike the catalog.
 */

/**
 * The list is written for the record and uses em dashes; a page never shows
 * one (CLAUDE.md, "User-facing copy"). A dash between clauses reads as a comma.
 */
export function plainWhy(why: string): string {
  return why.replace(/\s*\u2014\s*/g, ", ");
}

const WHY: ReadonlyMap<string, string> = new Map(
  (notable as { fileHash: string; why: string }[]).map((n) => [n.fileHash, plainWhy(n.why)]),
);

export function notableWhy(fileHash: string): string | undefined {
  return WHY.get(fileHash);
}
