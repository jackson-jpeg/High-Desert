"use client";

import { cn } from "@/lib/utils/cn";
import { ReactNode } from "react";
import { TitleBar, type TitleBarProps } from "./TitleBar";

export interface WindowProps {
  title: string;
  icon?: ReactNode;
  active?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  titleBarProps?: Partial<TitleBarProps>;
  children: ReactNode;
  className?: string;
  variant?: "classic" | "dark";
  footer?: ReactNode;
  /** Render title as a semantic heading (h1–h6). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

export function Window({
  title,
  icon,
  active = true,
  onClose,
  onMinimize,
  onMaximize,
  titleBarProps,
  children,
  className,
  variant = "dark",
  footer,
  headingLevel,
}: WindowProps) {
  return (
    <div
      className={cn(
        "flex flex-col animate-window-open",
        variant === "classic" && "w98-raised bg-[var(--w98-surface)]",
        variant === "dark" && "w98-raised-dark bg-raised-surface glass-heavy",
        className,
      )}
    >
      <TitleBar
        title={title}
        icon={icon}
        active={active}
        onClose={onClose}
        onMinimize={onMinimize}
        onMaximize={onMaximize}
        headingLevel={headingLevel}
        {...titleBarProps}
      />
      <div className="flex-1 overflow-auto p-1">{children}</div>
      {footer && <div className="flex-shrink-0">{footer}</div>}
    </div>
  );
}
