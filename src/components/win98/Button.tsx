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
          "active:scale-[0.97] active:brightness-90 transition-transform duration-75",
          "md:active:scale-100 md:active:brightness-100",
          "md:active:pt-[5px] md:active:pb-[3px] md:active:pl-[17px] md:active:pr-[15px]",
          "focus-visible:outline-dotted focus-visible:outline-1 focus-visible:outline-offset-[-4px] focus-visible:shadow-[inset_0_0_0_3px_rgba(0,120,215,0.3)]",
          "disabled:text-[var(--w98-text-disabled)] disabled:cursor-default disabled:active:scale-100 disabled:active:brightness-100",
          variant === "default" && "w98-button",
          variant === "flat" && [
            "bg-transparent border border-transparent text-desktop-gray",
            "hover:border hover:border-bevel-light hover:border-b-bevel-dark hover:border-r-bevel-dark",
            "active:border-bevel-dark active:border-b-bevel-light active:border-r-bevel-light",
          ],
          variant === "dark" && [
            "w98-raised-dark bg-raised-surface text-desktop-gray",
          ],
          size === "sm" && "px-3 py-2.5 text-hd-12 min-h-[44px] min-w-0 md:px-2 md:py-0.5 md:text-hd-10 md:min-h-0",
          size === "md" && "px-4 py-2.5 text-hd-13 min-h-[44px] min-w-[75px] md:py-1 md:text-hd-11 md:min-h-0",
          size === "lg" && "px-6 py-3 text-hd-14 min-h-[44px] min-w-[90px] md:py-1.5 md:text-hd-12 md:min-h-0",
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
