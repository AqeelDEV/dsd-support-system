import { describe, expect, it } from "vitest";

import {
  assignmentRequestSchema,
  customerReplyFieldsSchema,
  customerTicketFieldsSchema,
  guestTicketFieldsSchema,
  pageQuerySchema,
  queueQuerySchema,
  staffReplyFieldsSchema,
} from "./requests.js";

const AGENT_ID = "0199a1b2-0000-7000-8000-000000000001";

describe("ticket request schemas", () => {
  it("takes a guest's email, subject and description", () => {
    const parsed = guestTicketFieldsSchema.parse({
      email: "ana@example.com",
      subject: "  Card declined  ",
      description: "It was declined twice.",
    });
    expect(parsed.subject).toBe("Card declined");
  });

  it.each([
    ["status", { status: "resolved" }],
    ["priority", { priority: "urgent" }],
    ["channel", { channel: "email" }],
    ["customerId", { customerId: AGENT_ID }],
  ])(
    "refuses a customer-chosen %s (mass assignment)",
    (_field, extra: Record<string, string>) => {
      const result = customerTicketFieldsSchema.safeParse({
        subject: "Card declined",
        description: "It was declined twice.",
        ...extra,
      });
      expect(result.success).toBe(false);
    },
  );

  it("refuses a customer reply that tries to become an internal note", () => {
    expect(
      customerReplyFieldsSchema.safeParse({
        body: "Thanks",
        visibility: "internal",
      }).success,
    ).toBe(false);
  });

  it("refuses NUL characters, which PostgreSQL text can't store", () => {
    expect(
      customerReplyFieldsSchema.safeParse({ body: "a\u0000b" }).success,
    ).toBe(false);
  });

  it("refuses blank text and enforces the column limits", () => {
    const subject = (value: string) =>
      customerTicketFieldsSchema.safeParse({
        subject: value,
        description: "x",
      }).success;
    expect(subject("   ")).toBe(false);
    expect(subject("x".repeat(200))).toBe(true);
    expect(subject("x".repeat(201))).toBe(false);
  });

  it("lets an agent reply carry a new status, and nothing else extra", () => {
    expect(
      staffReplyFieldsSchema.parse({ body: "Done", status: "resolved" }).status,
    ).toBe("resolved");
    expect(
      staffReplyFieldsSchema.safeParse({ body: "Done", priority: "low" })
        .success,
    ).toBe(false);
  });

  it("accepts exactly the three assignment intents", () => {
    expect(assignmentRequestSchema.safeParse({ action: "claim" }).success).toBe(
      true,
    );
    expect(
      assignmentRequestSchema.safeParse({ action: "assign", agentId: AGENT_ID })
        .success,
    ).toBe(true);
    expect(
      assignmentRequestSchema.safeParse({ action: "assign" }).success,
    ).toBe(false);
    expect(
      assignmentRequestSchema.safeParse({ action: "claim", agentId: AGENT_ID })
        .success,
    ).toBe(false);
    expect(assignmentRequestSchema.safeParse({ action: "steal" }).success).toBe(
      false,
    );
  });
});

describe("queue and page queries", () => {
  it("defaults to the first page of 25, most urgent first", () => {
    expect(queueQuerySchema.parse({})).toEqual({ sort: "priority", limit: 25 });
  });

  it("takes one status as a string and several as a list", () => {
    expect(queueQuerySchema.parse({ status: "open" }).status).toEqual(["open"]);
    expect(
      queueQuerySchema.parse({ status: ["open", "pending_customer"] }).status,
    ).toEqual(["open", "pending_customer"]);
    expect(queueQuerySchema.safeParse({ status: "lost" }).success).toBe(false);
  });

  it("reads query-string numbers and booleans", () => {
    const parsed = queueQuerySchema.parse({ limit: "100", escalated: "true" });
    expect(parsed.limit).toBe(100);
    expect(parsed.escalated).toBe(true);
    expect(queueQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
  });

  it("filters by assignee as me, unassigned or an agent ID", () => {
    for (const assignee of ["me", "unassigned", AGENT_ID]) {
      expect(queueQuerySchema.parse({ assignee }).assignee).toBe(assignee);
    }
    expect(queueQuerySchema.safeParse({ assignee: "someone" }).success).toBe(
      false,
    );
  });

  it("refuses unknown query parameters", () => {
    expect(pageQuerySchema.safeParse({ offset: "50" }).success).toBe(false);
  });
});
