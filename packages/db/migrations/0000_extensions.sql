-- pgvector must exist before the kb_chunks.embedding column. It isn't a
-- trusted extension, so a superuser creates it when the database is set up
-- (docker/postgres/initdb, and the test harness). Here it is a no-op that
-- fails loudly if that step was skipped.
CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
-- Only the owning role (dsd_migrator) creates objects. PostgreSQL 15+ already
-- withholds this from PUBLIC; stating it keeps the rule visible in review.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
