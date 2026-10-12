"use client";

import { createContext, createElement, useContext, type ReactNode } from "react";
import type { Look } from "@/lib/look/look";

/**
 * Every page has a LookProvider (src/app/[look]/layout.tsx), so this is only
 * what a component mounted on its own sees, i.e. a unit test: the base
 * components, which are Night's. Win98 swaps some of them, and a test of a
 * Win98 swap says so with a provider. It is not the site's default
 * (DEFAULT_LOOK), which the proxy decides.
 */
const OUTSIDE_A_PAGE: Look = "night";

/**
 * The look this page was rendered in (src/lib/look/look.ts). The server knows
 * it (the `[look]` segment), so it is the same on the server, through
 * hydration and after: there is no swap after first paint.
 */
const LookContext = createContext<Look>(OUTSIDE_A_PAGE);

export function LookProvider({ look, children }: { look: Look; children?: ReactNode }) {
  return createElement(LookContext.Provider, { value: look }, children);
}

export function useLook(): Look {
  return useContext(LookContext);
}
