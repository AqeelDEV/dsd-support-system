import type { Pool } from "pg";

/*
 * Bulk tickets for measuring performance (NFR-1): thousands of tickets with
 * their customers, messages and audit history, on top of the demo seed.
 * The demo seed is written for people to read; this is written for the
 * planner and the clock, so it is generated in SQL, set-based, in seconds.
 *
 * Every pseudo-random choice comes from hashing the row's position with a
 * fixed salt (hashint8extended), so the same count gives the same data on
 * every run and machine. The mix is meant to look like a working queue:
 *
 *   status:   30% open, 15% waiting on the customer, 25% resolved, 30% closed
 *   priority:  8% urgent, 22% high, 50% normal, 20% low
 *   assigned: 60%, spread over the brand's active agents
 *   age:      up to 180 days, older tickets more likely settled
 *   thread:   2 to 7 messages (some of them internal notes), and every
 *             500th ticket a long one of 60, the slowest to open
 *
 * Each ticket gets the audit events its history implies: created, one per
 * message, assigned, and the status change that left it where it is.
 */

export interface BulkSeedResult {
  customers: number;
  tickets: number;
  messages: number;
  auditEvents: number;
}

/** The address the first bulk customer gets; its presence means bulk data is already there. */
export const FIRST_BULK_CUSTOMER = "bulk.customer.1@example.com";

/** One customer per this many tickets, so each has a handful. */
const TICKETS_PER_CUSTOMER = 5;

const SUBJECTS = [
  "Router keeps dropping the connection",
  "Camera shows offline in the app",
  "Refund hasn't reached my card",
  "Charged twice for one order",
  "Parcel marked delivered but not here",
  "Thermostat schedule resets overnight",
  "Smart plug won't pair with the hub",
  "Lamp flickers at low brightness",
  "Band battery drains in a day",
  "Can't sign in after changing my email",
  "Need a VAT invoice for my order",
  "Wrong item in the box",
  "Motion alerts arrive late",
  "Want to change my delivery address",
  "Device offline after a firmware update",
];

const FIRST_NAMES = [
  "Alex",
  "Sam",
  "Jordan",
  "Taylor",
  "Morgan",
  "Riley",
  "Casey",
  "Jamie",
  "Robin",
  "Avery",
];
const LAST_NAMES = [
  "Example",
  "Sample",
  "Placeholder",
  "Fictional",
  "Synthetic",
  "Testwood",
  "Demoford",
  "Mockley",
];

const BULK_SQL = String.raw`
WITH
  params AS (
    SELECT $1::uuid AS brand_id, $2::int AS ticket_count, $3::timestamptz AS anchor,
           $4::text[] AS subjects, $5::text[] AS first_names, $6::text[] AS last_names,
           $7::int AS customer_count
  ),
  staff AS (
    SELECT array_agg(a.id ORDER BY a.email_normalized) AS ids
      FROM agents a
      JOIN agent_brand_memberships m ON m.agent_id = a.id
     WHERE m.brand_id = (SELECT brand_id FROM params)
       AND a.deactivated_at IS NULL AND a.password_hash IS NOT NULL
  ),
  new_customers AS (
    INSERT INTO customers (email, email_normalized, display_name, created_at, updated_at)
    SELECT 'bulk.customer.' || c || '@example.com',
           'bulk.customer.' || c || '@example.com',
           p.first_names[1 + c % cardinality(p.first_names)] || ' ' ||
             p.last_names[1 + (c / cardinality(p.first_names)) % cardinality(p.last_names)],
           p.anchor - interval '200 days', p.anchor - interval '200 days'
      FROM params p, generate_series(1, p.customer_count) AS c
    RETURNING id, email_normalized
  ),
  customer_list AS (
    SELECT array_agg(id ORDER BY substring(email_normalized FROM '[0-9]+')::int) AS ids
      FROM new_customers
  ),
  draws AS (
    SELECT g,
           abs(hashint8extended(g, 1)) % 100 AS status_roll,
           abs(hashint8extended(g, 2)) % 100 AS priority_roll,
           abs(hashint8extended(g, 3)) % 100 AS assign_roll,
           abs(hashint8extended(g, 4)) % 1000 AS assignee_roll,
           abs(hashint8extended(g, 5)) % (180 * 24 * 60) AS age_minutes,
           abs(hashint8extended(g, 6)) % 1000 AS subject_roll,
           abs(hashint8extended(g, 7)) % 6 AS extra_messages,
           abs(hashint8extended(g, 8)) % 100 AS channel_roll
      FROM params p, generate_series(1, p.ticket_count) AS g
  ),
  planned AS (
    SELECT d.g,
           CASE WHEN d.status_roll < 30 THEN 'open'
                WHEN d.status_roll < 45 THEN 'pending_customer'
                WHEN d.status_roll < 70 THEN 'resolved'
                ELSE 'closed' END::ticket_status AS status,
           CASE WHEN d.priority_roll < 8 THEN 'urgent'
                WHEN d.priority_roll < 30 THEN 'high'
                WHEN d.priority_roll < 80 THEN 'normal'
                ELSE 'low' END::ticket_priority AS priority,
           CASE WHEN d.channel_roll < 90 THEN 'web' ELSE 'email' END::ticket_channel AS channel,
           CASE WHEN d.assign_roll < 60 AND cardinality(s.ids) > 0
                THEN s.ids[1 + d.assignee_roll % cardinality(s.ids)] END AS assignee,
           s.ids[1 + d.assignee_roll % greatest(cardinality(s.ids), 1)] AS responder,
           cl.ids[1 + d.g % cardinality(cl.ids)] AS customer_id,
           p.subjects[1 + d.subject_roll % cardinality(p.subjects)] AS subject,
           -- Open tickets are recent; settled ones are at least 9 days old,
           -- so they could have been resolved and closed by now.
           p.anchor - make_interval(mins => (CASE WHEN d.status_roll < 45
                                                  THEN d.age_minutes % (14 * 24 * 60) + 60
                                                  ELSE d.age_minutes + 9 * 24 * 60 END)::int) AS created_at,
           (CASE WHEN d.g % 500 = 0 THEN 60 ELSE 2 + d.extra_messages END)::int AS message_count
      FROM draws d, params p, staff s, customer_list cl
  ),
  new_tickets AS (
    INSERT INTO tickets (brand_id, customer_id, channel, subject, description, status, priority,
                         assignee_agent_id, first_response_at, resolved_at, closed_at,
                         created_at, updated_at, reference)
    SELECT p.brand_id, t.customer_id, t.channel, t.subject,
           'Generated for the performance run (ticket ' || t.g || '). ' ||
             'The customer describes the problem in a few sentences, as customers do.',
           t.status, t.priority, t.assignee,
           CASE WHEN t.status <> 'open' OR t.g % 3 = 0
                THEN least(t.created_at + interval '2 hours', p.anchor) END,
           CASE WHEN t.status IN ('resolved', 'closed') THEN t.created_at + interval '1 day' END,
           CASE WHEN t.status = 'closed' THEN t.created_at + interval '8 days' END,
           t.created_at, least(t.created_at + interval '1 day', p.anchor),
           ''
      FROM planned t, params p
    RETURNING id, customer_id, status, assignee_agent_id, created_at,
              substring(description FROM 'ticket ([0-9]+)')::int AS g
  ),
  ticket_plan AS (
    SELECT n.id, n.customer_id, n.status, n.assignee_agent_id, n.created_at,
           t.message_count, t.responder
      FROM new_tickets n JOIN planned t ON t.g = n.g
  ),
  new_messages AS (
    INSERT INTO messages (ticket_id, author_type, author_customer_id, author_agent_id,
                          visibility, body, created_at)
    SELECT tp.id,
           CASE WHEN m % 2 = 1 THEN 'customer' ELSE 'agent' END::participant_type,
           CASE WHEN m % 2 = 1 THEN tp.customer_id END,
           CASE WHEN m % 2 = 0 THEN coalesce(tp.assignee_agent_id, tp.responder) END,
           CASE WHEN m % 2 = 0 AND m % 6 = 0 THEN 'internal' ELSE 'public' END::message_visibility,
           CASE WHEN m % 2 = 1
                THEN 'Following up with a little more detail about what I tried (message ' || m || ').'
                WHEN m % 6 = 0
                THEN 'Internal note: checked the account and the order history (message ' || m || ').'
                ELSE 'Thanks for the detail. Here is what to try next (message ' || m || ').' END,
           -- 37 minutes apart, but never after the anchor; still in order.
           least(tp.created_at + make_interval(mins => m * 37),
                 p.anchor - make_interval(mins => tp.message_count - m + 1))
      FROM ticket_plan tp, params p, generate_series(1, tp.message_count) AS m
     -- A customer opens the thread; agents can only answer once there is someone to answer.
     WHERE m % 2 = 1 OR tp.responder IS NOT NULL OR tp.assignee_agent_id IS NOT NULL
    RETURNING id, ticket_id, author_type, author_customer_id, author_agent_id, visibility, created_at
  ),
  new_audit AS (
    INSERT INTO audit_events (ticket_id, entity_type, entity_id, action, actor_type,
                              actor_customer_id, actor_agent_id, before, after, request_id, created_at)
    SELECT tp.id, 'ticket', tp.id, 'ticket.created', 'customer'::actor_type, tp.customer_id,
           NULL::uuid, NULL::jsonb,
           jsonb_build_object('status', 'open', 'priority', 'normal', 'channel', 'web'),
           'bulk-seed', tp.created_at
      FROM ticket_plan tp
    UNION ALL
    SELECT tp.id, 'ticket', tp.id, 'ticket.assigned', 'agent'::actor_type, NULL::uuid,
           tp.assignee_agent_id,
           jsonb_build_object('assigneeAgentId', NULL),
           jsonb_build_object('assigneeAgentId', tp.assignee_agent_id),
           'bulk-seed', tp.created_at + interval '30 minutes'
      FROM ticket_plan tp WHERE tp.assignee_agent_id IS NOT NULL
    UNION ALL
    SELECT tp.id, 'ticket', tp.id, 'ticket.status_changed', 'agent'::actor_type, NULL::uuid,
           coalesce(tp.assignee_agent_id, tp.responder),
           jsonb_build_object('status', 'open'), jsonb_build_object('status', tp.status),
           'bulk-seed', least(tp.created_at + interval '1 day', p.anchor)
      FROM ticket_plan tp, params p
     WHERE tp.status <> 'open' AND coalesce(tp.assignee_agent_id, tp.responder) IS NOT NULL
    UNION ALL
    SELECT m.ticket_id, 'message', m.id, 'message.created', m.author_type::text::actor_type,
           m.author_customer_id, m.author_agent_id, NULL,
           jsonb_build_object('visibility', m.visibility), 'bulk-seed', m.created_at
      FROM new_messages m
    RETURNING 1
  )
SELECT (SELECT count(*) FROM new_customers)::int AS customers,
       (SELECT count(*) FROM new_tickets)::int AS tickets,
       (SELECT count(*) FROM new_messages)::int AS messages,
       (SELECT count(*) FROM new_audit)::int AS audit_events
`;

/**
 * Adds `tickets` generated tickets to the demo brand, with their customers,
 * messages and audit events, in one transaction, then refreshes the
 * planner's statistics. Run as `dsd_migrator` on a database the demo seed
 * has filled. It refuses to run twice, because history can't be deleted.
 */
export async function seedBulkTickets(
  pool: Pool,
  options: { tickets: number; anchor?: Date },
): Promise<BulkSeedResult> {
  if (!Number.isInteger(options.tickets) || options.tickets < 1) {
    throw new Error("The ticket count must be a positive whole number");
  }
  const client = await pool.connect();
  try {
    const brand = await client.query<{ id: string }>(
      "SELECT id FROM brands WHERE slug = 'dsd'",
    );
    const brandId = brand.rows[0]?.id;
    if (brandId === undefined) {
      throw new Error("The demo seed hasn't run: there is no DSD brand");
    }
    const existing = await client.query(
      "SELECT 1 FROM customers WHERE email_normalized = $1",
      [FIRST_BULK_CUSTOMER],
    );
    if (existing.rowCount !== 0) {
      throw new Error("Bulk tickets are already in this database");
    }

    await client.query("BEGIN");
    const result = await client.query<{
      customers: number;
      tickets: number;
      messages: number;
      audit_events: number;
    }>(BULK_SQL, [
      brandId,
      options.tickets,
      options.anchor ?? new Date(),
      SUBJECTS,
      FIRST_NAMES,
      LAST_NAMES,
      Math.max(1, Math.ceil(options.tickets / TICKETS_PER_CUSTOMER)),
    ]);
    await client.query("COMMIT");
    await client.query(
      "ANALYZE customers, tickets, messages, audit_events, attachments",
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("The bulk insert returned nothing");
    return {
      customers: row.customers,
      tickets: row.tickets,
      messages: row.messages,
      auditEvents: row.audit_events,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
