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
        "w98-button !min-w-0 !px-1 !py-0 w-[16px] h-[14px]",
        "flex items-center justify-center text-[9px] leading-none font-bold",
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
}: TitleBarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-[2px] select-none",
        active ? "w98-titlebar-gradient" : "w98-titlebar-inactive-gradient",
        className,
      )}
    >
      {icon && <span className="mr-1 flex-shrink-0">{icon}</span>}
      <span
        className={cn(
          "w98-font text-[11px] font-bold truncate flex-1",
          active ? "text-white" : "text-[#D4D4D4]",
        )}
      >
        {title}
      </span>
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
