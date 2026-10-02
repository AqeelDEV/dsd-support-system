import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "./cn";
import { Spinner } from "./spinner";

/*
 * Sizes follow the two densities (ADR-0013): `sm` (32 px) is the agent
 * app's control height, `lg` (44 px) the customer app's touch-friendly one.
 */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium whitespace-nowrap transition-colors select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 aria-busy:cursor-progress [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.12)] hover:bg-primary/92 active:bg-primary/85",
        secondary:
          "border border-border-strong bg-card text-foreground hover:bg-muted active:bg-muted/70",
        ghost: "text-foreground hover:bg-muted active:bg-muted/70",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        "destructive-outline":
          "border border-border-strong bg-card text-tone-danger-fg hover:bg-tone-danger-soft",
        link: "h-auto px-0 text-primary underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-7 px-2 text-xs",
        sm: "h-8 px-3 text-sm",
        md: "h-9 px-3.5 text-base",
        lg: "h-11 px-5 text-base",
        icon: "size-8 p-0",
        "icon-lg": "size-11 p-0",
      },
    },
    compoundVariants: [{ variant: "link", className: "h-auto px-0" }],
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Shows a spinner, marks the button busy and blocks repeat clicks. */
    pending?: boolean;
  };

/** A button. Defaults to `type="button"` so it never submits a form by accident. */
export function Button({
  className,
  variant,
  size,
  type = "button",
  pending = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled === true || pending}
      aria-busy={pending || undefined}
      {...props}
    >
      {pending ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  );
}
