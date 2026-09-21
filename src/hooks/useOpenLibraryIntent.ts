"use client";

import { useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";
import { libraryIntentHref, type LibraryIntent } from "@/lib/library/intents";

/**
 * Ask the library to do something, from anywhere (HD-013).
 *
 * Always a navigation to the intent URL — never an event, which would reach
 * nothing on a route where the library is not mounted. From another route it
 * pushes, so Back returns to where the listener was. On /library it replaces
 * the history entry: the library clears the parameters again straight away,
 * and a push would leave a duplicate /library entry behind every menu pick.
 * That replace is `history.replaceState`, which Next's router follows
 * (useSearchParams updates) without the server round trip of
 * `router.replace` — the page is already here.
 */
export function useOpenLibraryIntent(): (intent: LibraryIntent) => void {
  const router = useRouter();
  const pathname = usePathname();
  return useCallback(
    (intent: LibraryIntent) => {
      const href = libraryIntentHref(intent);
      if (pathname === "/library") window.history.replaceState(null, "", href);
      else router.push(href);
    },
    [router, pathname],
  );
}
