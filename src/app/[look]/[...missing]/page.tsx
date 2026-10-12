import { notFound } from "next/navigation";

/**
 * Any path no route claims, inside a look: the look's own 404
 * (src/app/[look]/not-found.tsx), drawn in that look. Without it an unknown
 * URL fell through to the global 404, which knows no look.
 */
export const dynamicParams = true;

export function generateStaticParams(): { missing: string[] }[] {
  return [];
}

export default function Missing(): never {
  notFound();
}
