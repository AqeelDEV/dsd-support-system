import {
  type AssignmentRequest,
  permissionsFor,
  PROBLEM_TYPES,
  type Permission,
} from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { ProblemException } from "../../../common/problem-details.js";
import {
  allowedActions,
  allowedTransitionsFor,
  decideAssignment,
  type StaffView,
  type TicketState,
} from "./ticket-actions.js";

const ME = "0199a1b2-0000-7000-8000-00000000000a";
const COLLEAGUE = "0199a1b2-0000-7000-8000-00000000000b";

const as = (role: "agent" | "supervisor"): StaffView => ({
  agentId: ME,
  permissions: new Set(permissionsFor(role)),
});
const agent = as("agent");
const supervisor = as("supervisor");

const ticket = (
  status: TicketState["status"],
  assigneeAgentId: string | null,
): TicketState => ({ status, assigneeAgentId });

function refusal(action: () => unknown): ProblemException {
  try {
    action();
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error("expected a ProblemException");
}

describe("allowedActions", () => {
  it("lets an agent do everything on an unassigned open ticket", () => {
    expect(allowedActions(agent, ticket("open", null))).toEqual({
      reply: true,
      addNote: true,
      changeStatus: true,
      changePriority: true,
      claim: true,
      assign: true,
      unassign: false,
      escalate: true,
      viewAuditTrail: true,
    });
  });

  it("keeps an agent off a colleague's ticket's assignment, but not a supervisor", () => {
    const held = ticket("open", COLLEAGUE);
    expect(allowedActions(agent, held)).toMatchObject({
      claim: false,
      assign: false,
      unassign: false,
      reply: true,
    });
    expect(allowedActions(supervisor, held)).toMatchObject({
      claim: false,
      assign: true,
      unassign: true,
    });
  });

  it("lets the holder hand on or give back their own ticket", () => {
    expect(allowedActions(agent, ticket("pending_customer", ME))).toMatchObject(
      { claim: false, assign: true, unassign: true },
    );
  });

  it("leaves only internal notes and the history on a closed ticket", () => {
    const actions = allowedActions(supervisor, ticket("closed", ME));
    expect(
      Object.entries(actions)
        .filter(([, allowed]) => allowed)
        .map(([name]) => name),
    ).toEqual(["addNote", "viewAuditTrail"]);
  });

  it("follows the permissions, not the role name", () => {
    const readOnly: StaffView = {
      agentId: ME,
      permissions: new Set<Permission>(["ticket:read:any"]),
    };
    expect(
      Object.values(allowedActions(readOnly, ticket("open", null))),
    ).not.toContain(true);
    expect(allowedTransitionsFor(readOnly, ticket("open", null))).toEqual([]);
  });

  it("reports the status machine's targets", () => {
    expect(allowedTransitionsFor(agent, ticket("resolved", null))).toEqual([
      "open",
      "closed",
    ]);
  });
});

describe("decideAssignment (ADR-0007, section 5)", () => {
  const claim: AssignmentRequest = { action: "claim" };
  const giveTo = (agentId: string): AssignmentRequest => ({
    action: "assign",
    agentId,
  });
  const unassign: AssignmentRequest = { action: "unassign" };

  it("claims an unassigned ticket", () => {
    expect(decideAssignment(agent, ticket("open", null), claim)).toEqual({
      assigneeAgentId: ME,
    });
  });

  it("refuses a claim on someone else's ticket with 409, even for a supervisor", () => {
    for (const staff of [agent, supervisor]) {
      const error = refusal(() =>
        decideAssignment(staff, ticket("open", COLLEAGUE), claim),
      );
      expect(error.getStatus()).toBe(409);
      expect(error.problemType).toBe(PROBLEM_TYPES.alreadyAssigned);
    }
  });

  it("changes nothing when the ticket already ends up where asked", () => {
    expect(decideAssignment(agent, ticket("open", ME), claim)).toBe(
      "unchanged",
    );
    expect(decideAssignment(agent, ticket("open", null), unassign)).toBe(
      "unchanged",
    );
    expect(
      decideAssignment(agent, ticket("open", COLLEAGUE), giveTo(COLLEAGUE)),
    ).toBe("unchanged");
  });

  it("lets an agent hand an unassigned or own ticket to a colleague", () => {
    for (const holder of [null, ME]) {
      expect(
        decideAssignment(agent, ticket("open", holder), giveTo(COLLEAGUE)),
      ).toEqual({ assigneeAgentId: COLLEAGUE });
    }
    expect(decideAssignment(agent, ticket("open", ME), unassign)).toEqual({
      assigneeAgentId: null,
    });
  });

  it.each([
    ["take it", giveTo(ME)],
    ["unassign it", unassign],
  ])(
    "refuses an agent who tries to %s from a colleague (403)",
    (_name, request) => {
      const error = refusal(() =>
        decideAssignment(agent, ticket("open", COLLEAGUE), request),
      );
      expect(error.getStatus()).toBe(403);
    },
  );

  it("lets a supervisor reassign or unassign any ticket", () => {
    expect(
      decideAssignment(supervisor, ticket("open", COLLEAGUE), giveTo(ME)),
    ).toEqual({ assigneeAgentId: ME });
    expect(
      decideAssignment(supervisor, ticket("open", COLLEAGUE), unassign),
    ).toEqual({ assigneeAgentId: null });
  });

  it("refuses any change on a closed ticket", () => {
    const error = refusal(() =>
      decideAssignment(supervisor, ticket("closed", COLLEAGUE), unassign),
    );
    expect(error.getStatus()).toBe(409);
    expect(error.problemType).toBe(PROBLEM_TYPES.ticketClosed);
  });
});
