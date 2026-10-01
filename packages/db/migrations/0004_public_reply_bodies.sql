-- The worker reads message text only through this view (ADR-0006, ADR-0008,
-- amended). Notification emails quote an agent's public reply; nothing else
-- in the worker needs message bodies, so the worker loses SELECT on
-- `messages` altogether and sees only what has already been sent to a
-- customer: never an internal note, never a customer's own message.
--
-- The view is owned by dsd_migrator and is not security_invoker, so it reads
-- `messages` with its owner's rights; the worker's grant is on the view
-- alone. Its filter can't be bypassed by the worker, which can't change it.

CREATE VIEW public_reply_bodies AS
  SELECT id, ticket_id, body, created_at
    FROM messages
   WHERE visibility = 'public' AND author_type = 'agent';
--> statement-breakpoint
GRANT SELECT ON public_reply_bodies TO dsd_worker;
--> statement-breakpoint
REVOKE SELECT ON messages FROM dsd_worker;
