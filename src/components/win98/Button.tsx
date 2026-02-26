"use client";

import { cn } from "@/lib/utils/cn";
import { ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "flat" | "dark";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", children, "aria-label": ariaLabel, ...props }, ref) => {
    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        if (!props.disabled) {
          (e.currentTarget as HTMLButtonElement).click();
        }
      }
      props.onKeyDown?.(e);
    };

    return (
      <button
        ref={ref}
        role="button"
        tabIndex={props.disabled ? -1 : 0}
        aria-label={ariaLabel || (typeof children === "string" ? children : undefined)}
        aria-disabled={props.disabled}
        className={cn(
          "w98-font cursor-pointer select-none outline-none",
          "md:active:pt-[5px] md:active:pb-[3px] md:active:pl-[17px] md:active:pr-[15px]",
          "focus-visible:outline-dotted focus-visible:outline-1 focus-visible:outline-offset-[-4px]",
          "disabled:text-[var(--w98-text-disabled)] disabled:cursor-default",
          variant === "default" && "w98-button",
          variant === "flat" && [
            "bg-transparent border border-transparent text-desktop-gray",
            "hover:border hover:border-bevel-light hover:border-b-bevel-dark hover:border-r-bevel-dark",
            "active:border-bevel-dark active:border-b-bevel-light active:border-r-bevel-light",
          ],
          variant === "dark" && [
            "w98-raised-dark bg-raised-surface text-desktop-gray",
          ],
          size === "sm" && "px-3 py-2.5 text-[12px] min-h-[44px] min-w-0 md:px-2 md:py-0.5 md:text-[10px] md:min-h-0",
          size === "md" && "px-4 py-2.5 text-[13px] min-h-[44px] min-w-[75px] md:py-1 md:text-[11px] md:min-h-0",
          size === "lg" && "px-6 py-3 text-[14px] min-h-[44px] min-w-[90px] md:py-1.5 md:text-[12px] md:min-h-0",
          className,
        )}
        onKeyDown={handleKeyDown}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
