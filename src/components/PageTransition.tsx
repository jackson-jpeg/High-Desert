"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const prevPath = useRef(pathname);
  const reducedMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      if (reducedMotion) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: triggers page transition animation
      setVisible(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    }
  }, [pathname, reducedMotion]);

  return (
    <div
      className="h-full"
      style={{
        opacity: visible ? 1 : 0,
        // Only apply transform during transition — translateY(0) creates a containing block
        // that traps position:fixed children (e.g. mobile detail panels, backdrops)
        transform: visible ? "none" : "translateY(8px)",
        transition: reducedMotion ? "none" : "opacity 200ms ease-out, transform 200ms ease-out",
      }}
    >
      {children}
    </div>
  );
}
