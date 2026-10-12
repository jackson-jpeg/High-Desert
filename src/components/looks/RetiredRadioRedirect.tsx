"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { currentLook } from "@/hooks/useLook";
import { DIAL_HREF, radioRetired } from "@/lib/look/nav";

/**
 * /radio in a preview look goes to the Library's Dial mode (src/lib/look/nav.ts).
 * The proxy redirects a request for the page; this covers a client-side
 * navigation the proxy did not see. Renders nothing, and in the public look
 * does nothing.
 */
export function RetiredRadioRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (radioRetired(currentLook())) router.replace(DIAL_HREF);
  }, [router]);
  return null;
}
