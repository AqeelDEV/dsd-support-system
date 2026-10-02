import { PROBLEM_TYPES, TICKET_STATUSES, type TicketStatus } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { ProblemException } from "../../../common/problem-details.js";
import {
  agentTransitions,
  assertAgentTransition,
  customerMayReply,
  statusAfterCustomerReply,
  timestampChanges,
} from "./ticket-status.js";

/**
 * ADR-0007's transition table, written out again here rather than imported,
 * so a change to the module has to be made twice, on purpose.
 */
const ALLOWED_FOR_AGENTS = new Set([
  "open->pending_customer",
  "open->resolved",
  "open->closed",
  "pending_customer->open",
  "pending_customer->resolved",
  "pending_customer->closed",
  "resolved->open",
  "resolved->closed",
]);

const pairs = TICKET_STATUSES.flatMap((from) =>
  TICKET_STATUSES.filter((to) => to !== from).map(
    (to) => [from, to] as [TicketStatus, TicketStatus],
  ),
);

function thrown(action: () => unknown): ProblemException {
  try {
    action();
  } catch (error) {
    if (error instanceof ProblemException) return error;
    throw error;
  }
  throw new Error("expected a ProblemException");
}

describe("agent status changes (ADR-0007, section 2)", () => {
  it.each(pairs)("%s -> %s follows the table", (from, to) => {
    const allowed = ALLOWED_FOR_AGENTS.has(`${from}->${to}`);
    expect(agentTransitions(from).includes(to)).toBe(allowed);
    if (allowed) {
      expect(() => {
        assertAgentTransition(from, to);
      }).not.toThrow();
    } else {
      const error = thrown(() => {
        assertAgentTransition(from, to);
      });
      expect(error.getStatus()).toBe(409);
      expect(error.problemType).toBe(PROBLEM_TYPES.invalidStatusTransition);
      expect(error.extensions.allowedTransitions).toEqual(
        agentTransitions(from),
      );
    }
  });

  it("treats closed as terminal", () => {
    expect(agentTransitions("closed")).toEqual([]);
  });
});

describe("a customer's reply (ADR-0007, section 2)", () => {
  it.each([
    ["open", "open"],
    ["pending_customer", "open"],
    ["resolved", "open"],
  ] as const)("on a %s ticket leaves it %s", (from, to) => {
    expect(statusAfterCustomerReply(from)).toBe(to);
  });

  it("is refused on a closed ticket", () => {
    const error = thrown(() => statusAfterCustomerReply("closed"));
    expect(error.getStatus()).toBe(409);
    expect(error.problemType).toBe(PROBLEM_TYPES.ticketClosed);
  });

  it.each([
    ["open", true],
    ["pending_customer", true],
    ["resolved", true],
    ["closed", false],
  ] as const)("is offered on a %s ticket: %s", (status, offered) => {
    expect(customerMayReply(status)).toBe(offered);
  });
});

describe("lifecycle timestamps (ADR-0007, section 3)", () => {
  it.each([
    ["open", "resolved", "set", "keep"],
    ["pending_customer", "resolved", "set", "keep"],
    ["resolved", "open", "clear", "keep"],
    ["resolved", "closed", "keep", "set"],
    ["open", "closed", "keep", "set"],
    ["pending_customer", "open", "keep", "keep"],
    ["open", "pending_customer", "keep", "keep"],
  ] as const)(
    "%s -> %s: resolved_at %s, closed_at %s",
    (from, to, resolvedAt, closedAt) => {
      expect(timestampChanges(from, to)).toEqual({ resolvedAt, closedAt });
    },
  );
});
