import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "focus:outline-hidden focus:ring-ring/50 inline-flex items-center justify-center rounded-md border px-2 py-0.5 text-xs font-medium w-fit whitespace-nowrap shrink-0 gap-1 overflow-hidden transition-[color,box-shadow] focus:ring-[3px] [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground [a&]:hover:bg-primary/90",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90",
        outline: "border-border bg-background text-foreground",
        success: "border-transparent bg-primary/15 text-primary",
        warning: "border-transparent bg-chart-4/20 text-chart-4",
        danger: "border-transparent bg-destructive/15 text-destructive",
        info: "border-transparent bg-chart-2/20 text-chart-2",
        violet: "border-transparent bg-chart-3/20 text-chart-3",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
