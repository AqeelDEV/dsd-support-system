import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  customerMessageSchema,
  customerTicketSchema,
  customerTicketSummarySchema,
  staffMessageSchema,
  staffTicketSchema,
} from "./responses.js";

/** Every property name anywhere in a JSON schema. */
function propertyNames(schema: unknown): string[] {
  if (typeof schema !== "object" || schema === null) return [];
  const names: string[] = [];
  for (const [key, value] of Object.entries(schema) as [string, unknown][]) {
    if (key === "properties" && typeof value === "object" && value !== null) {
      names.push(...Object.keys(value));
    }
    names.push(...propertyNames(value));
  }
  return names;
}

/** Fields that describe staff work, which a customer must never receive (FR-10). */
const STAFF_ONLY = [
  "visibility",
  "priority",
  "assignee",
  "escalatedAt",
  "escalatedBy",
  "contactVerified",
  "allowedActions",
  "allowedTransitions",
  "updatedAt",
  // AI suggestions are for staff only (ADR-0006).
  "aiSuggestionId",
  "aiSuggestion",
  "draft",
  "citations",
];

describe("customer response schemas", () => {
  it.each([
    ["the ticket list", customerTicketSummarySchema],
    ["a ticket", customerTicketSchema],
    ["a message", customerMessageSchema],
  ])("give %s no field that could carry staff-only data", (_name, schema) => {
    const names = propertyNames(z.toJSONSchema(schema));
    expect(names.filter((name) => STAFF_ONLY.includes(name))).toEqual([]);
  });

  it("drop a field a query returned by mistake", () => {
    const parsed = customerMessageSchema.parse({
      id: "0199a1b2-0000-7000-8000-000000000001",
      author: { type: "agent", name: "Sam" },
      body: "Hello",
      attachments: [],
      createdAt: "2026-10-01T09:00:00.000Z",
      visibility: "internal",
    });
    expect(parsed).not.toHaveProperty("visibility");
  });

  it("are a strict subset of what staff see", () => {
    const staff = new Set(propertyNames(z.toJSONSchema(staffTicketSchema)));
    const customer = propertyNames(z.toJSONSchema(customerTicketSchema)).filter(
      // The customer view adds its own status timeline, and `canReply`,
      // the customer's side of the staff `allowedActions.reply`.
      (name) => !["timeline", "at", "canReply"].includes(name),
    );
    expect(customer.filter((name) => !staff.has(name))).toEqual([]);
    expect(propertyNames(z.toJSONSchema(staffMessageSchema))).toContain(
      "visibility",
    );
    expect(propertyNames(z.toJSONSchema(staffMessageSchema))).toContain(
      "aiSuggestionId",
    );
  });
});
