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
  className?: string;
}

export function StatusBar({ panels, className }: StatusBarProps) {
  return (
    <div className={cn("w98-statusbar", className)}>
      {panels.map((panel, i) => (
        <div
          key={i}
          className="w98-statusbar-panel w98-font"
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
