import { cva, type VariantProps } from "class-variance-authority";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
  XCircle,
} from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./cn";

/*
 * Hairlines and layers (ADR-0013, signature detail 3): content sits on a
 * white panel with one 1 px border on a slightly darker canvas. No shadow;
 * only overlays cast one.
 */

export function Panel({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-lg border border-border bg-card text-card-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
  as: Heading = "h2",
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  as?: "h1" | "h2" | "h3";
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-base font-semibold">{title}</Heading>
        {description === undefined ? null : (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

const alertVariants = cva(
  "flex gap-3 rounded-md border px-3.5 py-3 text-sm [&_a]:font-medium [&_a]:underline [&_a]:underline-offset-2",
  {
    variants: {
      tone: {
        info: "border-tone-info/25 bg-tone-info-soft text-tone-info-fg",
        success:
          "border-tone-success/25 bg-tone-success-soft text-tone-success-fg",
        warning:
          "border-tone-warning/35 bg-tone-warning-soft text-tone-warning-fg",
        danger: "border-tone-danger/25 bg-tone-danger-soft text-tone-danger-fg",
      },
    },
    defaultVariants: { tone: "info" },
  },
);

const alertIcons: Record<
  "info" | "success" | "warning" | "danger",
  LucideIcon
> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
};

export type AlertProps = Omit<ComponentProps<"div">, "title"> &
  VariantProps<typeof alertVariants> & { title?: ReactNode };

/**
 * A message in the flow of the page. Danger alerts are announced at once
 * (`role="alert"`); the others politely (`role="status"`).
 */
export function Alert({
  tone,
  title,
  className,
  children,
  ...props
}: AlertProps) {
  const Icon = alertIcons[tone ?? "info"];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(alertVariants({ tone }), className)}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-0.5">
        {title === undefined ? null : <p className="font-semibold">{title}</p>}
        {children === undefined ? null : <div>{children}</div>}
      </div>
    </div>
  );
}

/** What a list or page shows when there is nothing in it yet. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-12 text-center",
        className,
      )}
    >
      {Icon === undefined ? null : (
        <span className="mb-4 grid size-10 place-items-center rounded-lg border border-border bg-muted text-muted-foreground">
          <Icon aria-hidden="true" className="size-5" />
        </span>
      )}
      <p className="text-base font-semibold">{title}</p>
      {description === undefined ? null : (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {description}
        </p>
      )}
      {action === undefined ? null : <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Initials on a neutral disc: people are told apart by name, not by colour. */
export function Avatar({
  name,
  size = "md",
  className,
}: {
  name: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const initials = (name ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full border border-border bg-muted font-semibold text-muted-foreground select-none",
        size === "sm" && "size-6 text-[0.625rem]",
        size === "md" && "size-8 text-xs",
        size === "lg" && "size-10 text-sm",
        className,
      )}
    >
      {initials === "" ? "?" : initials}
    </span>
  );
}

/** A keyboard key, for shortcut hints. */
export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-[0.25rem] border border-border-strong bg-card px-1 font-sans text-[0.6875rem] leading-none font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--color-border)]",
        className,
      )}
      {...props}
    />
  );
}
