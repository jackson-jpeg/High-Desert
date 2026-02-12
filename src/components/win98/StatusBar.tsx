"use client";

import { cn } from "@/lib/utils/cn";
import { ReactNode } from "react";

export interface StatusBarPanel {
  content: ReactNode;
  flex?: number;
  width?: string;
}

export interface StatusBarProps {
  panels: StatusBarPanel[];
  variant?: "classic" | "dark";
  className?: string;
}

export function StatusBar({ panels, variant = "classic", className }: StatusBarProps) {
  const isDark = variant === "dark";
  return (
    <div className={cn(isDark ? "w98-statusbar-dark" : "w98-statusbar", className)}>
      {panels.map((panel, i) => (
        <div
          key={i}
          className={cn(isDark ? "w98-statusbar-panel-dark" : "w98-statusbar-panel", "w98-font")}
          style={{
            flex: panel.flex ?? (i === 0 ? 1 : undefined),
            width: panel.width,
          }}
        >
          {panel.content}
        </div>
      ))}
    </div>
  );
}
