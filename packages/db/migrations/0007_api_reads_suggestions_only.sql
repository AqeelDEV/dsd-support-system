-- The API reads AI suggestions and never writes one (ADR-0006, ADR-0008,
-- amended). Suggestions are the worker's output: the API only lists them for
-- staff and records which one a reply used, on the message. Migration 0003
-- gave the API INSERT on ai_suggestions as well, which no code ever used.
-- Taking it away means a compromised or buggy API can't plant a "suggestion"
-- for an agent to send, so a draft can only ever come from the pipeline
-- that grounds and validates it.

REVOKE INSERT ON ai_suggestions FROM dsd_api;
