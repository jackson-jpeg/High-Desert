"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The fine print, one small link away (UI plan push 6, batch 5): "How we
 * count" opens the notes that used to sit under the numbers. A native
 * <details>, so it works by keyboard and without script.
 */
export function HowWeCount({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return (
    <details className={cn("hd-how-we-count text-hd-micro text-bevel-dark", className)} data-how-we-count={id}>
      <summary className="hd-how-we-count-link inline-flex items-center min-h-touch md:min-h-0 cursor-pointer select-none text-signal-blue underline underline-offset-2">
        How we count
      </summary>
      <div className="mt-1 flex flex-col gap-1 text-bevel-dark">{children}</div>
    </details>
  );
}
