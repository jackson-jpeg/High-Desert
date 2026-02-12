"use client";

import { cn } from "@/lib/utils/cn";
import { InputHTMLAttributes, forwardRef } from "react";

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: "classic" | "dark";
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(
  ({ className, variant = "dark", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "w98-font text-[11px] px-1 py-0.5 outline-none",
          variant === "classic" && [
            "w98-inset bg-white text-black",
          ],
          variant === "dark" && [
            "w98-inset-dark bg-inset-well text-desktop-gray",
            "placeholder:text-bevel-dark",
          ],
          className,
        )}
        {...props}
      />
    );
  },
);

TextField.displayName = "TextField";
