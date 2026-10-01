-- Reply emails name the agent who wrote the reply, so the view carries the
-- author's agent ID as well. It is still only public agent replies: the
-- filter doesn't change, and the worker can already read `agents`.
-- CREATE OR REPLACE VIEW may only add columns at the end, which this does.

CREATE OR REPLACE VIEW public_reply_bodies AS
  SELECT id, ticket_id, body, created_at, author_agent_id
    FROM messages
   WHERE visibility = 'public' AND author_type = 'agent';
