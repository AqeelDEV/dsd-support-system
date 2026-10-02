import type {
  AgentRole,
  AgentStatus,
  KbArticleStatus,
  TicketPriority,
  TicketStatus,
} from "@dsd/shared";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "./cn";

/*
 * Status and priority colour appears only as a small tinted badge with a dot
 * (ADR-0013, section 1). The labels live here once, so the two apps can't
 * name a status differently.
 */

export const STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  pending_customer: "Awaiting customer",
  resolved: "Resolved",
  closed: "Closed",
};

/** The customer sees the same states worded from their side. */
export const CUSTOMER_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "Open",
  pending_customer: "Awaiting your reply",
  resolved: "Resolved",
  closed: "Closed",
};

export const PRIORITY_LABELS: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const ROLE_LABELS: Record<AgentRole, string> = {
  agent: "Agent",
  supervisor: "Supervisor",
  admin: "Admin",
};

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  active: "Active",
  invited: "Invited",
  deactivated: "Deactivated",
};

export const ARTICLE_STATUS_LABELS: Record<KbArticleStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const STATUS_TONES: Record<TicketStatus, Tone> = {
  open: "info",
  pending_customer: "warning",
  resolved: "success",
  closed: "neutral",
};

const PRIORITY_TONES: Record<TicketPriority, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
};

const AGENT_STATUS_TONES: Record<AgentStatus, Tone> = {
  active: "success",
  invited: "info",
  deactivated: "neutral",
};

const ARTICLE_STATUS_TONES: Record<KbArticleStatus, Tone> = {
  draft: "neutral",
  published: "success",
  archived: "warning",
};

const badgeVariants = cva(
  "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full px-2 text-xs font-medium whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "bg-tone-neutral-soft text-tone-neutral-fg",
        info: "bg-tone-info-soft text-tone-info-fg",
        success: "bg-tone-success-soft text-tone-success-fg",
        warning: "bg-tone-warning-soft text-tone-warning-fg",
        danger: "bg-tone-danger-soft text-tone-danger-fg",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

const dotTones: Record<Tone, string> = {
  neutral: "bg-tone-neutral",
  info: "bg-tone-info",
  success: "bg-tone-success",
  warning: "bg-tone-warning",
  danger: "bg-tone-danger",
};

export type BadgeProps = ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { dot?: boolean };

export function Badge({
  className,
  tone,
  dot = false,
  children,
  ...props
}: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ tone }), className)} {...props}>
      {dot ? (
        <span
          aria-hidden="true"
          className={cn("size-1.5 rounded-full", dotTones[tone ?? "neutral"])}
        />
      ) : null}
      {children}
    </span>
  );
}

export function StatusBadge({
  status,
  audience = "staff",
  className,
}: {
  status: TicketStatus;
  audience?: "staff" | "customer";
  className?: string;
}) {
  const labels =
    audience === "customer" ? CUSTOMER_STATUS_LABELS : STATUS_LABELS;
  return (
    <Badge tone={STATUS_TONES[status]} dot className={className}>
      {labels[status]}
    </Badge>
  );
}

/** Low and normal are quiet: only high and urgent should catch the eye. */
export function PriorityBadge({
  priority,
  className,
}: {
  priority: TicketPriority;
  className?: string;
}) {
  if (PRIORITY_TONES[priority] === "neutral") {
    return (
      <span
        className={cn(
          "inline-flex h-5 shrink-0 items-center gap-1.5 px-2 text-xs whitespace-nowrap text-muted-foreground",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-tone-neutral/60"
        />
        {PRIORITY_LABELS[priority]}
      </span>
    );
  }
  return (
    <Badge tone={PRIORITY_TONES[priority]} dot className={className}>
      {PRIORITY_LABELS[priority]}
    </Badge>
  );
}

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  return (
    <Badge tone={AGENT_STATUS_TONES[status]} dot>
      {AGENT_STATUS_LABELS[status]}
    </Badge>
  );
}

export function ArticleStatusBadge({ status }: { status: KbArticleStatus }) {
  return (
    <Badge tone={ARTICLE_STATUS_TONES[status]} dot>
      {ARTICLE_STATUS_LABELS[status]}
    </Badge>
  );
}
