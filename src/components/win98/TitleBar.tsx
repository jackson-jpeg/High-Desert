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
  /** id for the title element, so a Dialog can point aria-labelledby at it. */
  titleId?: string;
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
        "flex items-center justify-center text-hd-14 md:text-hd-9 leading-none font-bold",
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
  titleId,
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
        id={titleId}
        className={cn(
          "w98-font text-hd-13 md:text-hd-11 font-bold truncate flex-1",
          /* Dark text on the inactive bar: #D4D4D4 sat at 1.46–2.66:1 across
             its #808080→#B0B0B0 gradient. #1F1F1F gives 4.2–7.6:1. */
          active ? "w98-titlebar-title text-white" : "text-[#1F1F1F]",
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
