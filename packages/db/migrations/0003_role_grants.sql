-- Least-privilege access for the API and the worker (ADR-0008), exactly as
-- the privilege matrix in docs/DATA_MODEL.md. Nothing uses ALTER DEFAULT
-- PRIVILEGES: a new table is unreachable by both roles until a migration
-- grants access, so a forgotten grant fails a test instead of opening a gap.
-- The privilege snapshot test compares the result with the matrix.

GRANT USAGE ON SCHEMA public TO dsd_api, dsd_worker;
--> statement-breakpoint

-- The API. History tables (messages, audit_events) are SELECT and INSERT
-- only; the outbox is write-only; AI retrieval data is read-only.
GRANT SELECT ON brands TO dsd_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON customers, agents, tickets TO dsd_api;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON agent_brand_memberships TO dsd_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON sessions, auth_tokens, kb_categories TO dsd_api;
--> statement-breakpoint
GRANT SELECT, INSERT ON messages, attachments, audit_events, ai_suggestions TO dsd_api;
--> statement-breakpoint
GRANT INSERT ON outbox_events TO dsd_api;
--> statement-breakpoint
GRANT SELECT ON notification_deliveries, kb_chunks, ai_suggestion_sources TO dsd_api;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON kb_articles, canned_responses, ai_suggestion_feedback TO dsd_api;
--> statement-breakpoint
GRANT USAGE ON SEQUENCE ticket_number_seq TO dsd_api;
--> statement-breakpoint

-- The worker reads what its handlers need and writes only its own outputs:
-- suggestions, retrieval chunks, delivery records and email tokens. It has
-- no INSERT, UPDATE or DELETE on messages, tickets or audit_events, so the
-- AI pipeline can't create a customer-visible message even if its code
-- tried (ADR-0006).
GRANT SELECT ON brands, customers, agents, agent_brand_memberships, tickets, messages, attachments, kb_categories, kb_articles TO dsd_worker;
--> statement-breakpoint
GRANT SELECT, UPDATE, DELETE ON outbox_events TO dsd_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON notification_deliveries, kb_chunks, ai_suggestions TO dsd_worker;
--> statement-breakpoint
GRANT SELECT, INSERT ON ai_suggestion_sources TO dsd_worker;
--> statement-breakpoint
-- Expired sessions and tokens are cleaned up by the worker, which may read
-- only the columns that say when they expire.
GRANT DELETE ON sessions TO dsd_worker;
--> statement-breakpoint
GRANT SELECT (expires_at, idle_expires_at) ON sessions TO dsd_worker;
--> statement-breakpoint
GRANT INSERT, DELETE ON auth_tokens TO dsd_worker;
--> statement-breakpoint
GRANT SELECT (expires_at) ON auth_tokens TO dsd_worker;
