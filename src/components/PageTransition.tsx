"use client";

import { usePathname } from "next/navigation";
import { ReactNode, useEffect, useRef, useState } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true);
  const prevPath = useRef(pathname);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  useEffect(() => {
    if (pathname !== prevPath.current) {
      prevPath.current = pathname;
      if (reducedMotion) return;
      setVisible(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setVisible(true));
      });
    }
  }, [pathname, reducedMotion]);

  return (
    <div
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
