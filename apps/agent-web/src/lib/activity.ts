import type { AuditEvent, TicketPriority, TicketStatus } from "@dsd/shared";
import { PRIORITY_LABELS, STATUS_LABELS } from "@dsd/ui";

export type EventTone = "neutral" | "info" | "success" | "warning";

export interface DescribedEvent {
  /** "Status changed to Resolved", without the actor. */
  text: string;
  tone: EventTone;
  /** Whether it belongs on the conversation's status rail, or only in the full activity list. */
  onRail: boolean;
}

const STATUS_TONES: Record<TicketStatus, EventTone> = {
  open: "info",
  pending_customer: "warning",
  resolved: "success",
  closed: "neutral",
};

const field = (record: Record<string, unknown> | null, name: string) =>
  record?.[name];

/**
 * Words for an audit event (ADR-0008), for the thread's status rail and
 * the activity tab. Agent IDs become names through `nameOf`; anyone it
 * doesn't know is "a colleague". Unknown actions are shown by their name,
 * so a new kind of event is never hidden.
 */
export function describeEvent(
  event: AuditEvent,
  nameOf: (agentId: string) => string | undefined,
): DescribedEvent {
  const agent = (id: unknown) =>
    typeof id === "string" ? (nameOf(id) ?? "a colleague") : undefined;
  switch (event.action) {
    case "ticket.created":
      return { text: "Ticket opened", tone: "info", onRail: false };
    case "ticket.status_changed": {
      const status = field(event.after, "status") as TicketStatus | undefined;
      return status === undefined || !(status in STATUS_LABELS)
        ? { text: "Status changed", tone: "neutral", onRail: true }
        : {
            text: `Status changed to ${STATUS_LABELS[status]}`,
            tone: STATUS_TONES[status],
            onRail: true,
          };
    }
    case "ticket.priority_changed": {
      const priority = field(event.after, "priority") as
        TicketPriority | undefined;
      return {
        text:
          priority === undefined || !(priority in PRIORITY_LABELS)
            ? "Priority changed"
            : `Priority set to ${PRIORITY_LABELS[priority]}`,
        tone:
          priority === "urgent" || priority === "high" ? "warning" : "neutral",
        onRail: true,
      };
    }
    case "ticket.assigned": {
      const to = agent(field(event.after, "assigneeAgentId"));
      return {
        text: to === undefined ? "Unassigned" : `Assigned to ${to}`,
        tone: "neutral",
        onRail: true,
      };
    }
    case "ticket.escalated": {
      const to = agent(field(event.after, "assigneeAgentId"));
      return {
        text: to === undefined ? "Escalated" : `Escalated to ${to}`,
        tone: "warning",
        onRail: true,
      };
    }
    case "message.created":
      return {
        text:
          field(event.after, "visibility") === "internal"
            ? "Added an internal note"
            : "Sent a reply",
        tone: "neutral",
        onRail: false,
      };
    case "attachment.created":
      return { text: "Attached a file", tone: "neutral", onRail: false };
    default:
      return { text: event.action, tone: "neutral", onRail: false };
  }
}
