-- The AI pipeline drafts replies from what the customer wrote (ADR-0006,
-- amended). The worker has no privilege on `messages`, so it reads customers'
-- messages through this view, the same way it reads agents' public replies
-- through public_reply_bodies. Customers can only write public messages
-- (messages_customer_public_ck); the filter names both conditions anyway, so
-- the view never depends on that constraint to keep internal notes out.
--
-- Owned by dsd_migrator and not security_invoker, so it reads `messages` with
-- its owner's rights; the worker's grant is on the view alone and it can't
-- change the filter.

CREATE VIEW public_customer_messages AS
  SELECT id, ticket_id, body, created_at
    FROM messages
   WHERE author_type = 'customer' AND visibility = 'public';
--> statement-breakpoint
GRANT SELECT ON public_customer_messages TO dsd_worker;
