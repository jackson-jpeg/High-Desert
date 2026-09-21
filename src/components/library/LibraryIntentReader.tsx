"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  parseLibraryIntent,
  hasIntent,
  hasIntentParams,
  withoutIntentParams,
  type LibraryIntent,
} from "@/lib/library/intents";

/**
 * Reads a library intent from the URL (src/lib/library/intents.ts), hands it
 * over, and clears it from the address bar — no history entry, and a reload
 * does not shuffle again. The clear is `history.replaceState`, which Next's
 * router observes (useSearchParams follows it), not `router.replace`: that is
 * a soft navigation with a server round trip for the RSC payload, and under
 * load the parameters sat in the address bar for over ten seconds. Runs on mount and whenever a
 * client-side navigation brings new parameters to an already-mounted library.
 *
 * A component rather than a hook in the page: `useSearchParams()` needs a
 * Suspense boundary to prerender, and wrapping this alone keeps the rest of
 * the library in the static HTML.
 */
export function LibraryIntentReader({ onIntent }: { onIntent: (intent: LibraryIntent) => void }) {
  const params = useSearchParams();
  const pathname = usePathname();
  const deliver = useEffectEvent(onIntent);
  // The query string last acted on. Development's double effect would
  // otherwise shuffle twice; and it resets to "" once the parameters are
  // cleared, so asking for the same shuffle again still works.
  const handled = useRef<string | null>(null);

  const search = params.toString();
  useEffect(() => {
    if (handled.current === search) return;
    handled.current = search;
    const current = new URLSearchParams(search);
    if (!hasIntentParams(current)) return;
    window.history.replaceState(null, "", `${pathname}${withoutIntentParams(search)}`);
    const intent = parseLibraryIntent(current);
    if (hasIntent(intent)) deliver(intent);
  }, [search, pathname]);

  return null;
}
