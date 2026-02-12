"use client";

import { cn } from "@/lib/utils/cn";
import { ButtonHTMLAttributes, forwardRef } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "flat" | "dark";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "w98-font cursor-pointer select-none outline-none",
          "active:pt-[5px] active:pb-[3px] active:pl-[17px] active:pr-[15px]",
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
          size === "sm" && "px-2 py-0.5 text-[10px] min-w-0",
          size === "md" && "px-4 py-1 text-[11px] min-w-[75px]",
          size === "lg" && "px-6 py-1.5 text-[12px] min-w-[90px]",
          className,
        )}
        {...props}
      >
        {children}
      </button>
    );
  },
);

Button.displayName = "Button";
