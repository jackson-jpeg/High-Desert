"use client";

import { cn } from "@/lib/utils/cn";
import { ReactNode } from "react";

export interface TitleBarProps {
  title: string;
  icon?: ReactNode;
  active?: boolean;
  onClose?: () => void;
  onMinimize?: () => void;
  onMaximize?: () => void;
  className?: string;
  /** Render the title as a semantic heading element (h1–h6). Defaults to span. */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

function TitleBarButton({
  onClick,
  label,
  children,
}: {
  onClick?: () => void;
  label: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className={cn(
        "w98-button !min-w-0 !px-1 !py-0 w-[44px] h-[44px] md:w-[16px] md:h-[14px]",
        "flex items-center justify-center text-[14px] md:text-[9px] leading-none font-bold",
        "focus-visible:outline-dotted focus-visible:outline-1 focus-visible:outline-white focus-visible:outline-offset-[-2px]",
      )}
    >
      {children}
    </button>
  );
}

export function TitleBar({
  title,
  icon,
  active = true,
  onClose,
  onMinimize,
  onMaximize,
  className,
  headingLevel,
}: TitleBarProps) {
  const HeadingTag = headingLevel ? (`h${headingLevel}` as const) : "span";

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-[2px] select-none",
        active ? "w98-titlebar-gradient" : "w98-titlebar-inactive-gradient",
        className,
      )}
    >
      {icon && <span className="mr-1 flex-shrink-0">{icon}</span>}
      <HeadingTag
        className={cn(
          "w98-font text-[13px] md:text-[11px] font-bold truncate flex-1",
          active ? "text-white" : "text-[#D4D4D4]",
        )}
      >
        {title}
      </HeadingTag>
      <div className="flex gap-[2px] flex-shrink-0">
        {onMinimize && (
          <TitleBarButton onClick={onMinimize} label="Minimize">
            _
          </TitleBarButton>
        )}
        {onMaximize && (
          <TitleBarButton onClick={onMaximize} label="Maximize">
            □
          </TitleBarButton>
        )}
        {onClose && (
          <TitleBarButton onClick={onClose} label="Close">
            ✕
          </TitleBarButton>
        )}
      </div>
    </div>
  );
}
