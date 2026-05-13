"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn("text-sm font-medium text-ink-700", className)}
    {...props}
  />
));
Label.displayName = "Label";
