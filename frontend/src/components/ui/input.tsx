"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "flex h-10 w-full rounded-md border border-ink-300 bg-white/70 px-3 py-2 text-sm text-ink-800 placeholder:text-ink-400",
        "focus-visible:border-scarlet-500 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-scarlet-500/40",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
