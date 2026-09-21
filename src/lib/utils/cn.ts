import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Every `--text-hd-*` font size registered in `src/app/globals.css`, without
 * the `text-` prefix: the eight semantic steps, then the legacy numeric
 * aliases that map onto them.
 *
 * tailwind-merge cannot read the theme. An unknown `text-<word>` looks like a
 * colour to it, so `text-hd-micro text-bevel-dark/85` merged as two colours and
 * the size was dropped — 46 `cn()` calls put a size before a colour, and each
 * rendered at the inherited body size. `cn.test.ts` parses globals.css and
 * fails if a token there is missing from this list.
 */
export const HD_FONT_SIZES = [
  "hd-micro", "hd-caption", "hd-body", "hd-title", "hd-h3", "hd-h2", "hd-display", "hd-hero",
  "hd-7", "hd-8", "hd-9", "hd-10", "hd-11", "hd-12", "hd-13", "hd-14", "hd-15", "hd-16",
  "hd-17", "hd-18", "hd-20", "hd-24", "hd-28", "hd-32", "hd-36", "hd-48",
] as const;

const HD_MERGE_CONFIG = {
  extend: {
    classGroups: {
      "font-size": [{ text: [...HD_FONT_SIZES] }],
    },
  },
};

const merge = extendTailwindMerge(HD_MERGE_CONFIG);

export function cn(...inputs: ClassValue[]) {
  return merge(clsx(inputs));
}
