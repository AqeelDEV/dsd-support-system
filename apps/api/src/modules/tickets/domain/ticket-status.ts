import { PROBLEM_TYPES, type TicketStatus } from "@dsd/shared";

import { ProblemException } from "../../../common/problem-details.js";

/*
 * The ticket lifecycle (ADR-0007, sections 1 to 3), in one place. Services
 * ask this module whether a change is allowed and which timestamps it
 * moves; staff responses carry `allowedTransitions` from here, so the agent
 * app never keeps its own copy of the rules.
 */

/** Where an agent can move a ticket from each status. `closed` is terminal. */
const AGENT_TRANSITIONS: Readonly<
  Record<TicketStatus, readonly TicketStatus[]>
> = {
  open: ["pending_customer", "resolved", "closed"],
  pending_customer: ["open", "resolved", "closed"],
  resolved: ["open", "closed"],
  closed: [],
};

/** The statuses an agent can move a ticket to from `from`. */
export function agentTransitions(from: TicketStatus): readonly TicketStatus[] {
  return AGENT_TRANSITIONS[from];
}

/**
 * Checks an agent's status change. The same status is a no-op the caller
 * skips before asking; anything else outside the table is a 409 that lists
 * where the ticket can go.
 */
export function assertAgentTransition(
  from: TicketStatus,
  to: TicketStatus,
): void {
  if (AGENT_TRANSITIONS[from].includes(to)) return;
  throw new ProblemException(
    409,
    PROBLEM_TYPES.invalidStatusTransition,
    from === "closed"
      ? "A closed ticket can't change status."
      : `A ticket can't move from ${from} to ${to}.`,
    {},
    { allowedTransitions: [...AGENT_TRANSITIONS[from]] },
  );
}

/**
 * What a customer's reply does to the status: an open ticket stays open,
 * one waiting on the customer or resolved reopens, so a reply is never lost
 * in a resolved ticket. Closed tickets refuse it.
 */
export function statusAfterCustomerReply(from: TicketStatus): TicketStatus {
  if (from === "closed") throw ticketClosed();
  return "open";
}

/**
 * A closed ticket is finished: it takes internal notes and nothing else
 * (ADR-0007, amended in Phase 4). Replies, priority, assignment and
 * escalation all refuse with this.
 */
export function ticketClosed(): ProblemException {
  return new ProblemException(
    409,
    PROBLEM_TYPES.ticketClosed,
    "This ticket is closed. It only takes internal notes; open a new ticket to continue.",
  );
}

export function assertNotClosed(status: TicketStatus): void {
  if (status === "closed") throw ticketClosed();
}

/** How a timestamp column changes with a transition. */
export type TimestampChange = "set" | "clear" | "keep";

/**
 * The lifecycle timestamps a transition moves (ADR-0007, section 3).
 * `resolved_at` always holds the latest resolution and is cleared when the
 * ticket reopens; `closed_at` is set once, on closing.
 */
export function timestampChanges(
  from: TicketStatus,
  to: TicketStatus,
): { resolvedAt: TimestampChange; closedAt: TimestampChange } {
  return {
    resolvedAt:
      to === "resolved"
        ? "set"
        : from === "resolved" && to === "open"
          ? "clear"
          : "keep",
    closedAt: to === "closed" ? "set" : "keep",
  };
}
