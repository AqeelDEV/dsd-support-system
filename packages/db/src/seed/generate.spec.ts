import {
  sanitizeMarkdown,
  SLUG_PATTERN,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
} from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { generateSeedPlan } from "./generate.js";

const ANCHOR = new Date("2026-09-30T12:00:00Z");

describe("generateSeedPlan", () => {
  it("produces the same plan for the same anchor", () => {
    expect(generateSeedPlan(ANCHOR)).toEqual(
      generateSeedPlan(new Date(ANCHOR)),
    );
  });

  it("moves every timestamp with the anchor and changes nothing else", () => {
    const later = new Date(ANCHOR.getTime() + 86_400_000);
    const shift = (plan: ReturnType<typeof generateSeedPlan>, by: number) =>
      JSON.parse(
        JSON.stringify(plan, (_key, value: unknown) =>
          typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)
            ? new Date(new Date(value).getTime() + by).toISOString()
            : value,
        ),
      ) as unknown;
    const original = generateSeedPlan(ANCHOR);
    const shifted = generateSeedPlan(later);
    // Dates written into message text and files (for example "22
    // September") move too, so compare the structure without free text.
    const withoutText = (plan: unknown) =>
      JSON.parse(
        JSON.stringify(plan, (key, value: unknown) =>
          ["body", "subject", "description", "details"].includes(key)
            ? ""
            : value,
        ),
      ) as unknown;
    expect(withoutText(shift(original, 86_400_000))).toEqual(
      withoutText(shifted),
    );
  });

  it("covers every status and priority, and keeps every event before the anchor", () => {
    const plan = generateSeedPlan(ANCHOR);
    expect(new Set(plan.tickets.map((ticket) => ticket.status))).toEqual(
      new Set(TICKET_STATUSES),
    );
    expect(new Set(plan.tickets.map((ticket) => ticket.priority))).toEqual(
      new Set(TICKET_PRIORITIES),
    );
    const times = plan.tickets.flatMap((ticket) => [
      ticket.createdAt,
      ticket.updatedAt,
      ...ticket.messages.map((message) => message.createdAt),
      ...ticket.audit.map((event) => event.createdAt),
    ]);
    expect(times.every((time) => time < ANCHOR)).toBe(true);
  });

  it("only ever uses reserved example domains for email addresses", () => {
    const plan = generateSeedPlan(ANCHOR);
    const emails = [...plan.agents, ...plan.customers].map(
      (person) => person.email,
    );
    expect(
      emails.every((email) =>
        /@(dsd\.example|example\.(com|net|org))$/.test(email),
      ),
    ).toBe(true);
    expect(new Set(emails).size).toBe(emails.length);
  });

  it("tells a consistent story on every ticket", () => {
    for (const ticket of generateSeedPlan(ANCHOR).tickets) {
      const lastStatusChange = ticket.audit
        .filter((event) => event.action === "ticket.status_changed")
        .at(-1);
      const statusFromHistory =
        (lastStatusChange?.after as { status?: string } | undefined)?.status ??
        "open";
      expect(statusFromHistory).toBe(ticket.status);

      const firstAgentReply = ticket.messages.find(
        (message) =>
          message.author.type === "agent" && message.visibility === "public",
      );
      expect(ticket.firstResponseAt).toEqual(
        firstAgentReply?.createdAt ?? null,
      );
      expect(ticket.resolvedAt !== null).toBe(
        ticket.status === "resolved" || ticket.status === "closed",
      );
      expect(ticket.closedAt !== null).toBe(ticket.status === "closed");
      expect(ticket.escalatedAt !== null).toBe(ticket.escalatedByKey !== null);
    }
  });

  it("writes knowledge-base articles the API would store unchanged", () => {
    for (const article of generateSeedPlan(ANCHOR).kbArticles) {
      expect(sanitizeMarkdown(article.body)).toBe(article.body);
      expect(article.slug).toMatch(SLUG_PATTERN);
      if (article.publishedAt !== null) {
        expect(article.publishedAt.getTime()).toBeGreaterThan(
          article.createdAt.getTime(),
        );
      }
    }
  });
});
