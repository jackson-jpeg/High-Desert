"use client";

import { useSyncExternalStore } from "react";
import { isPreviewLook, type Look } from "@/lib/look/look";

/**
 * The look this page is in (src/lib/look/look.ts). "default" on the server and
 * through hydration, so the server HTML is always the public look's; the
 * preview's own components swap in right after. CSS does not wait for this:
 * it keys on `<html data-look>`, which the boot script sets before paint.
 */
export function currentLook(): Look {
  if (typeof document === "undefined") return "default";
  const v = document.documentElement.getAttribute("data-look");
  return isPreviewLook(v) ? v : "default";
}

const subscribe = () => () => {};

export function useLook(): Look {
  return useSyncExternalStore(subscribe, currentLook, () => "default");
}
