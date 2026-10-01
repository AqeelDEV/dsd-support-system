import {
  type AllowedActions,
  type AssignmentRequest,
  type Permission,
  PROBLEM_TYPES,
  type TicketStatus,
} from "@dsd/shared";

import { ProblemException } from "../../../common/problem-details.js";
import { agentTransitions, ticketClosed } from "./ticket-status.js";

/*
 * What a staff member may do to one ticket, from their permissions and the
 * ticket's state (ADR-0004, sections 3 and 5; ADR-0007, section 5). The
 * services enforce these rules and the staff responses report them as
 * `allowedActions`, from the same functions, so the two can't disagree.
 */

export interface StaffView {
  agentId: string;
  permissions: ReadonlySet<Permission>;
}

export interface TicketState {
  status: TicketStatus;
  assigneeAgentId: string | null;
}

/** The statuses this agent can move the ticket to now; none without `ticket:status:update`. */
export function allowedTransitionsFor(
  staff: StaffView,
  ticket: TicketState,
): TicketStatus[] {
  return staff.permissions.has("ticket:status:update")
    ? [...agentTransitions(ticket.status)]
    : [];
}

/** The ticket is unassigned or held by this agent: `ticket:assign` covers it. */
const isFreeOrMine = (staff: StaffView, ticket: TicketState) =>
  ticket.assigneeAgentId === null || ticket.assigneeAgentId === staff.agentId;

export function allowedActions(
  staff: StaffView,
  ticket: TicketState,
): AllowedActions {
  const can = (permission: Permission) => staff.permissions.has(permission);
  const open = ticket.status !== "closed";
  const mayAssign =
    (can("ticket:assign") && isFreeOrMine(staff, ticket)) ||
    can("ticket:reassign:any");
  return {
    reply: open && can("ticket:reply"),
    addNote: can("ticket:note:create"),
    changeStatus: allowedTransitionsFor(staff, ticket).length > 0,
    changePriority: open && can("ticket:priority:update"),
    claim: open && can("ticket:assign") && ticket.assigneeAgentId === null,
    assign: open && mayAssign,
    unassign: open && ticket.assigneeAgentId !== null && mayAssign,
    escalate: open && can("ticket:escalate"),
    viewAuditTrail: can("ticket:audit:read"),
  };
}

/**
 * The agent the ticket should end up with, or `unchanged` when the request
 * changes nothing. Throws the 409 or 403 the rules call for:
 *
 * - a claim only takes an unassigned ticket (409 if someone else has it);
 * - `ticket:assign` covers unassigned tickets and the agent's own;
 * - anything held by someone else needs `ticket:reassign:any` (403);
 * - a closed ticket keeps whoever it had (409).
 *
 * Whether the new assignee may take the brand's tickets is a data check the
 * service makes before calling this.
 */
export function decideAssignment(
  staff: StaffView,
  ticket: TicketState,
  request: AssignmentRequest,
): { assigneeAgentId: string | null } | "unchanged" {
  if (ticket.status === "closed") throw ticketClosed();
  const target = targetOf(staff, request);
  if (target === ticket.assigneeAgentId) return "unchanged";

  if (request.action === "claim" && ticket.assigneeAgentId !== null) {
    throw new ProblemException(
      409,
      PROBLEM_TYPES.alreadyAssigned,
      "Someone else has already taken this ticket.",
    );
  }
  if (
    !isFreeOrMine(staff, ticket) &&
    !staff.permissions.has("ticket:reassign:any")
  ) {
    throw new ProblemException(
      403,
      PROBLEM_TYPES.blank,
      "This ticket belongs to another agent. Ask a supervisor to reassign it.",
    );
  }
  return { assigneeAgentId: target };
}

/** Who the ticket should go to. The request schema guarantees `assign` names an agent. */
function targetOf(staff: StaffView, request: AssignmentRequest): string | null {
  switch (request.action) {
    case "claim":
      return staff.agentId;
    case "unassign":
      return null;
    case "assign":
      if (request.agentId === undefined) {
        throw new Error(
          "An assign request without an agentId passed validation",
        );
      }
      return request.agentId;
  }
}
