import { randomUUID } from "node:crypto";

import type { PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createTestDatabase,
  expectPgError,
  inRolledBackTransaction,
  SQLSTATE,
  type TestDatabase,
} from "../src/testing/index.js";
import { documentedChecks } from "./docs.js";
import * as fixture from "./fixtures.js";

type Scenario = Awaited<ReturnType<typeof fixture.scenario>>;

interface Violation {
  constraint: string;
  /** A statement built to break exactly this constraint, and its values. */
  statement: (
    ids: Scenario,
  ) => [string, unknown[]] | Promise<[string, unknown[]]>;
  /** Extra rows the statement needs. */
  prepare?: (
    client: PoolClient,
    ids: Scenario,
  ) => Promise<Partial<Scenario> & Record<string, string>>;
}

const token = () => Buffer.from(randomUUID());

/**
 * Each CHECK constraint in DATA_MODEL.md, with a row built to break it. The
 * database refuses states the application should never produce, so a bug
 * fails loudly instead of corrupting data (ADR-0008).
 */
const checkViolations: Violation[] = [
  {
    constraint: "brands_ticket_prefix_ck",
    statement: () => [
      "INSERT INTO brands (slug, name, ticket_prefix, support_email) VALUES ('lower', 'Lower', 'dsd', 'x@example.com')",
      [],
    ],
  },
  {
    constraint: "customers_password_needs_verified_ck",
    statement: () => [
      "INSERT INTO customers (email, email_normalized, password_hash) VALUES ('p@example.com', 'p@example.com', 'hash')",
      [],
    ],
  },
  {
    constraint: "sessions_realm_ck",
    statement: ({ customerId }) => [
      "INSERT INTO sessions (realm, token_hash, customer_id, idle_expires_at, expires_at) VALUES ('staff', $1, $2, now() + interval '1 hour', now() + interval '1 hour')",
      [token(), customerId],
    ],
  },
  {
    constraint: "sessions_expiry_ck",
    statement: ({ agentId }) => [
      "INSERT INTO sessions (realm, token_hash, agent_id, idle_expires_at, expires_at) VALUES ('staff', $1, $2, now(), now() - interval '1 second')",
      [token(), agentId],
    ],
  },
  {
    constraint: "auth_tokens_subject_ck",
    statement: ({ customerId }) => [
      "INSERT INTO auth_tokens (purpose, token_hash, customer_id, expires_at) VALUES ('guest_ticket_access', $1, $2, now() + interval '7 days')",
      [token(), customerId],
    ],
  },
  {
    constraint: "tickets_subject_length_ck",
    statement: ({ brandId, customerId }) => [
      "INSERT INTO tickets (brand_id, customer_id, channel, subject, description) VALUES ($1, $2, 'web', '', 'Description')",
      [brandId, customerId],
    ],
  },
  {
    constraint: "tickets_description_length_ck",
    statement: ({ brandId, customerId }) => [
      "INSERT INTO tickets (brand_id, customer_id, channel, subject, description) VALUES ($1, $2, 'web', 'Subject', repeat('x', 20001))",
      [brandId, customerId],
    ],
  },
  {
    constraint: "tickets_resolved_at_ck",
    statement: ({ ticketId }) => [
      "UPDATE tickets SET resolved_at = now() WHERE id = $1",
      [ticketId],
    ],
  },
  {
    constraint: "tickets_closed_at_ck",
    statement: ({ ticketId }) => [
      "UPDATE tickets SET status = 'closed' WHERE id = $1",
      [ticketId],
    ],
  },
  {
    constraint: "tickets_first_response_ck",
    statement: ({ ticketId }) => [
      "UPDATE tickets SET first_response_at = created_at - interval '1 minute' WHERE id = $1",
      [ticketId],
    ],
  },
  {
    constraint: "tickets_escalation_ck",
    statement: ({ ticketId }) => [
      "UPDATE tickets SET escalated_at = now() WHERE id = $1",
      [ticketId],
    ],
  },
  {
    constraint: "messages_author_ck",
    statement: ({ ticketId, agentId }) => [
      "INSERT INTO messages (ticket_id, author_type, author_agent_id, visibility, body) VALUES ($1, 'customer', $2, 'public', 'Hello')",
      [ticketId, agentId],
    ],
  },
  {
    constraint: "messages_customer_public_ck",
    statement: ({ ticketId, customerId }) => [
      "INSERT INTO messages (ticket_id, author_type, author_customer_id, visibility, body) VALUES ($1, 'customer', $2, 'internal', 'A note only staff should see')",
      [ticketId, customerId],
    ],
  },
  {
    constraint: "messages_ai_approval_ck",
    prepare: async (client, { ticketId }) => ({
      suggestionId: await fixture.aiSuggestion(client, ticketId),
    }),
    statement: ({ ticketId, agentId, ...rest }) => [
      "INSERT INTO messages (ticket_id, author_type, author_agent_id, visibility, body, ai_suggestion_id) VALUES ($1, 'agent', $2, 'public', 'Sent without approval', $3)",
      [ticketId, agentId, (rest as Record<string, string>).suggestionId],
    ],
  },
  {
    constraint: "messages_approver_is_author_ck",
    prepare: async (client, { ticketId }) => ({
      suggestionId: await fixture.aiSuggestion(client, ticketId),
      otherAgentId: await fixture.agent(client),
    }),
    statement: ({ ticketId, agentId, ...rest }) => {
      const extra = rest as Record<string, string>;
      return [
        "INSERT INTO messages (ticket_id, author_type, author_agent_id, visibility, body, ai_suggestion_id, approved_by_agent_id) VALUES ($1, 'agent', $2, 'public', 'Approved by someone else', $3, $4)",
        [ticketId, agentId, extra.suggestionId, extra.otherAgentId],
      ];
    },
  },
  {
    constraint: "messages_body_length_ck",
    statement: ({ ticketId, customerId }) => [
      "INSERT INTO messages (ticket_id, author_type, author_customer_id, visibility, body) VALUES ($1, 'customer', $2, 'public', '')",
      [ticketId, customerId],
    ],
  },
  {
    constraint: "attachments_uploader_ck",
    statement: ({ ticketId, customerId, agentId }) => [
      "INSERT INTO attachments (ticket_id, uploader_type, uploader_customer_id, uploader_agent_id, object_key, filename, content_type, size_bytes, sha256) VALUES ($1, 'customer', $2, $3, $4, 'a.png', 'image/png', 100, $5)",
      [ticketId, customerId, agentId, `attachments/${randomUUID()}`, token()],
    ],
  },
  {
    constraint: "attachments_size_ck",
    statement: ({ ticketId, customerId }) => [
      "INSERT INTO attachments (ticket_id, uploader_type, uploader_customer_id, object_key, filename, content_type, size_bytes, sha256) VALUES ($1, 'customer', $2, $3, 'big.pdf', 'application/pdf', 10485761, $4)",
      [ticketId, customerId, `attachments/${randomUUID()}`, token()],
    ],
  },
  {
    constraint: "audit_events_actor_ck",
    statement: ({ ticketId, agentId }) => [
      "INSERT INTO audit_events (ticket_id, entity_type, entity_id, action, actor_type, actor_agent_id, request_id) VALUES ($1, 'ticket', $1, 'ticket.status_changed', 'system', $2, 'test')",
      [ticketId, agentId],
    ],
  },
  {
    constraint: "kb_articles_published_ck",
    statement: ({ brandId, agentId }) => [
      "INSERT INTO kb_articles (brand_id, slug, title, body_markdown, status, author_agent_id, updated_by_agent_id) VALUES ($1, 'refunds', 'Refunds', 'How refunds work.', 'published', $2, $2)",
      [brandId, agentId],
    ],
  },
  {
    constraint: "ai_suggestions_ready_ck",
    statement: ({ ticketId }) => [
      "INSERT INTO ai_suggestions (ticket_id, trigger_event_id, provider, model, prompt_version, retrieval_mode, status) VALUES ($1, $2, 'mock', 'mock-1', 'reply-draft/v1', 'hybrid', 'ready')",
      [ticketId, randomUUID()],
    ],
  },
];

describe("constraints", () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await createTestDatabase("dsd_test_constraints");
  });

  afterAll(async () => {
    await db.drop();
  });

  async function violate(violation: Violation) {
    return inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
      const ids = await fixture.scenario(client);
      const extra =
        violation.prepare === undefined
          ? {}
          : await violation.prepare(client, ids);
      const [statement, values] = await violation.statement({
        ...ids,
        ...extra,
      });
      return expectPgError(client, statement, values);
    });
  }

  it("covers every CHECK constraint in DATA_MODEL.md", () => {
    expect(
      checkViolations.map((violation) => violation.constraint).sort(),
    ).toEqual(documentedChecks().sort());
  });

  it.each(checkViolations)(
    "$constraint rejects a row built to break it",
    async (violation) => {
      const error = await violate(violation);
      expect(error).toMatchObject({
        code: SQLSTATE.checkViolation,
        constraint: violation.constraint,
      });
    },
  );

  describe("the AI approval guardrail (ADR-0006)", () => {
    it("refuses a reply that uses another ticket's suggestion", async () => {
      const error = await inRolledBackTransaction(
        db.pool("dsd_migrator"),
        async (client) => {
          const { brandId, customerId, agentId, ticketId } =
            await fixture.scenario(client);
          const otherTicketId = await fixture.ticket(
            client,
            brandId,
            customerId,
          );
          const otherSuggestionId = await fixture.aiSuggestion(
            client,
            otherTicketId,
          );
          return expectPgError(
            client,
            "INSERT INTO messages (ticket_id, author_type, author_agent_id, visibility, body, ai_suggestion_id, approved_by_agent_id) VALUES ($1, 'agent', $2, 'public', 'Wrong ticket', $3, $2)",
            [ticketId, agentId, otherSuggestionId],
          );
        },
      );
      expect(error).toMatchObject({
        code: SQLSTATE.foreignKeyViolation,
        constraint: "messages_ai_suggestion_fk",
      });
    });

    it("accepts a reply the sending agent approved, from its own ticket's suggestion", async () => {
      await inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
        const { agentId, ticketId } = await fixture.scenario(client);
        const suggestionId = await fixture.aiSuggestion(client, ticketId);
        await client.query(
          "INSERT INTO messages (ticket_id, author_type, author_agent_id, visibility, body, ai_suggestion_id, approved_by_agent_id) VALUES ($1, 'agent', $2, 'public', 'Edited and sent', $3, $2)",
          [ticketId, agentId, suggestionId],
        );
      });
    });
  });

  describe("unique keys", () => {
    const duplicates: [
      string,
      (client: PoolClient, ids: Scenario) => Promise<[string, unknown[]]>,
    ][] = [
      [
        "customers_email_normalized_key",
        async (client) => {
          await client.query(
            "INSERT INTO customers (email, email_normalized) VALUES ('A@Example.com', 'a@example.com')",
          );
          return [
            "INSERT INTO customers (email, email_normalized) VALUES ('a@example.com', 'a@example.com')",
            [],
          ];
        },
      ],
      [
        "agents_email_normalized_key",
        async (client) => {
          await client.query(
            "INSERT INTO agents (email, email_normalized, display_name, role) VALUES ('s@dsd.example', 's@dsd.example', 'S', 'agent')",
          );
          return [
            "INSERT INTO agents (email, email_normalized, display_name, role) VALUES ('S@dsd.example', 's@dsd.example', 'S2', 'admin')",
            [],
          ];
        },
      ],
      [
        "sessions_token_hash_key",
        async (client, { agentId }) => {
          const hash = token();
          const insert =
            "INSERT INTO sessions (realm, token_hash, agent_id, idle_expires_at, expires_at) VALUES ('staff', $1, $2, now() + interval '1 hour', now() + interval '1 hour')";
          await client.query(insert, [hash, agentId]);
          return [insert, [hash, agentId]];
        },
      ],
      [
        "kb_articles_brand_slug_key",
        async (client, { brandId, agentId }) => {
          const insert =
            "INSERT INTO kb_articles (brand_id, slug, title, body_markdown, author_agent_id, updated_by_agent_id) VALUES ($1, 'reset-password', 'Reset your password', 'Steps.', $2, $2)";
          await client.query(insert, [brandId, agentId]);
          return [insert, [brandId, agentId]];
        },
      ],
      [
        "canned_responses_active_title_key",
        async (client, { brandId, agentId }) => {
          const insert =
            "INSERT INTO canned_responses (brand_id, title, body, created_by_agent_id, updated_by_agent_id) VALUES ($1, 'Refund issued', 'We have issued your refund.', $2, $2)";
          await client.query(insert, [brandId, agentId]);
          return [insert, [brandId, agentId]];
        },
      ],
      [
        "ai_suggestions_ticket_trigger_key",
        async (client, { ticketId }) => {
          const eventId = randomUUID();
          const insert =
            "INSERT INTO ai_suggestions (ticket_id, trigger_event_id, provider, model, prompt_version, retrieval_mode) VALUES ($1, $2, 'mock', 'mock-1', 'reply-draft/v1', 'hybrid')";
          await client.query(insert, [ticketId, eventId]);
          return [insert, [ticketId, eventId]];
        },
      ],
      [
        "ai_suggestion_feedback_agent_key",
        async (client, { ticketId, agentId }) => {
          const suggestionId = await fixture.aiSuggestion(client, ticketId);
          const insert =
            "INSERT INTO ai_suggestion_feedback (suggestion_id, agent_id, rating) VALUES ($1, $2, 'up')";
          await client.query(insert, [suggestionId, agentId]);
          return [insert, [suggestionId, agentId]];
        },
      ],
      [
        "notification_deliveries_event_channel_recipient_key",
        async (client, { ticketId }) => {
          const eventId = randomUUID();
          const insert =
            "INSERT INTO notification_deliveries (event_id, channel, recipient_address, template, ticket_id) VALUES ($1, 'email', 'c@example.com', 'ticket-received', $2)";
          await client.query(insert, [eventId, ticketId]);
          return [insert, [eventId, ticketId]];
        },
      ],
    ];

    it.each(duplicates)("%s rejects a duplicate", async (constraint, build) => {
      const error = await inRolledBackTransaction(
        db.pool("dsd_migrator"),
        async (client) => {
          const ids = await fixture.scenario(client);
          const [statement, values] = await build(client, ids);
          return expectPgError(client, statement, values);
        },
      );
      expect(error).toMatchObject({
        code: SQLSTATE.uniqueViolation,
        constraint,
      });
    });

    it("lets a retired canned response's title be reused", async () => {
      await inRolledBackTransaction(db.pool("dsd_migrator"), async (client) => {
        const { brandId, agentId } = await fixture.scenario(client);
        await client.query(
          "INSERT INTO canned_responses (brand_id, title, body, created_by_agent_id, updated_by_agent_id, retired_at) VALUES ($1, 'Delivery delayed', 'Old wording.', $2, $2, now())",
          [brandId, agentId],
        );
        await client.query(
          "INSERT INTO canned_responses (brand_id, title, body, created_by_agent_id, updated_by_agent_id) VALUES ($1, 'Delivery delayed', 'New wording.', $2, $2)",
          [brandId, agentId],
        );
      });
    });
  });
});
