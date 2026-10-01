/**
 * The RBAC matrix (ADR-0004, Verification): every route, crossed with every
 * kind of caller, with the status each must get. The route-coverage test
 * fails if a registered route is missing here, so no endpoint can ship
 * without someone deciding who may call it.
 *
 * Every request is sent the way our own pages would send it (a trusted
 * Origin, and the caller's own CSRF token), so a cell tests authorisation
 * and nothing else. Each phase adds the rows for its routes. A route can
 * have several rows, for example one per kind of resource it acts on.
 */

import { randomUUID } from "node:crypto";

import type { TestDatabase } from "@dsd/db/testing";

import type { NewAgent } from "../support/agents.js";
import type { NewArticle } from "../support/kb.js";
import type { NewTicket } from "../support/tickets.js";
import type { SeededIdentities } from "./actors.js";

export const ACTORS = [
  "anonymous",
  "customer",
  "otherCustomer",
  "guest",
  "agent",
  "supervisor",
  "admin",
  /** A session created before the agent was deactivated. */
  "deactivatedAgent",
  /** A valid customer token, planted in the staff session cookie. */
  "customerTokenInStaffCookie",
  /** A valid staff token, planted in the customer session cookie. */
  "staffTokenInCustomerCookie",
] as const;

export type Actor = (typeof ACTORS)[number];

/** What a row's `arrange` step can use. */
export interface Fixtures {
  database: TestDatabase;
  seeded: SeededIdentities;
  /** A fresh ticket, so a cell that changes one can't affect the next cell. */
  newTicket: (ticket: NewTicket) => Promise<string>;
  /** A second brand that no actor belongs to. */
  otherBrandId: () => Promise<string>;
  /** A file on the ticket, stored for real, so a download can succeed. */
  newAttachment: (ticketId: string) => Promise<string>;
  /** A fresh staff account, so a cell that changes one can't affect the next. */
  newAgent: (agent?: NewAgent) => Promise<string>;
  /** A fresh knowledge-base article, a draft unless the row says otherwise. */
  newArticle: (article?: NewArticle) => Promise<{ id: string; slug: string }>;
  /** A fresh, empty knowledge-base category. */
  newCategory: () => Promise<string>;
  /** A fresh canned response in the actors' brand. */
  newCannedResponse: () => Promise<string>;
}

/** What one cell sends, worked out by the row's `arrange` step. */
export interface Cell {
  /** Values for the `:name` segments of the row's path. */
  params?: Record<string, string>;
  /** A query string, for routes that read one. */
  query?: Record<string, string>;
  /** A JSON body. */
  body?: Record<string, unknown>;
  /** Multipart form fields, for routes that take files. */
  form?: Record<string, string>;
  /** The ticket the guest actor's session is scoped to in this cell. */
  guestTicketId?: string;
}

export interface MatrixRow extends Omit<
  Cell,
  "params" | "query" | "guestTicketId"
> {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The path as registered, with `:name` for each parameter. */
  path: string;
  /** Why this row expects what it does, for whoever reads a failure. */
  rule: string;
  expected: Record<Actor, number>;
  /** Runs before every cell; what it returns overrides the row's own body or form. */
  arrange?: (fixtures: Fixtures) => Promise<Cell>;
}

const forEveryone = (status: number): Record<Actor, number> =>
  Object.fromEntries(ACTORS.map((actor) => [actor, status])) as Record<
    Actor,
    number
  >;

/** Customers and guests get `status`; everyone else gets 401. */
const customersOnly = (status: number): Record<Actor, number> => ({
  ...forEveryone(401),
  customer: status,
  otherCustomer: status,
  guest: status,
});

/** Active staff of every role get `status`; everyone else gets 401. */
const staffOnly = (status: number): Record<Actor, number> => ({
  ...forEveryone(401),
  agent: status,
  supervisor: status,
  admin: status,
});

/**
 * Public routes are exercised with an empty body: the same 400 for every
 * caller shows the route neither needs nor reads a session.
 */
const publicForm = (path: string, rule: string): MatrixRow => ({
  method: "POST",
  path,
  body: {},
  rule,
  expected: forEveryone(400),
});

type RouteOnly = Pick<MatrixRow, "method" | "path" | "body" | "form">;

/**
 * The two rows every route on one customer ticket gets, each on a fresh
 * ticket per cell: one owned by the demo customer, and one owned by the
 * guest, whose session is scoped to it. Only the owner's session succeeds;
 * every other customer session gets 404, and staff sessions 401.
 */
const onCustomerTickets = (route: RouteOnly, success: number): MatrixRow[] => [
  {
    ...route,
    rule: "The demo customer's own ticket: never another customer's, nor a guest's",
    expected: {
      ...forEveryone(401),
      customer: success,
      otherCustomer: 404,
      guest: 404,
    },
    arrange: async ({ seeded, newTicket }) => ({
      params: { ticketId: await newTicket({ customerId: seeded.customerId }) },
    }),
  },
  {
    ...route,
    rule: "A guest's own ticket: open to the guest session scoped to it",
    expected: {
      ...forEveryone(401),
      customer: 404,
      otherCustomer: 404,
      guest: success,
    },
    arrange: async ({ seeded, newTicket }) => {
      const ticketId = await newTicket({ customerId: seeded.guest.customerId });
      return { params: { ticketId }, guestTicketId: ticketId };
    },
  },
];

/**
 * The two rows every route on one staff ticket gets, each on a fresh
 * ticket per cell: one in the actors' brand, where active staff get
 * `success`, and one in a brand none of them belongs to, which is a 404
 * for every role (ADR-0004, section 6). `ticket` sets up the ticket.
 */
const onStaffTickets = (
  route: RouteOnly,
  success: number,
  ticket: (seeded: Fixtures["seeded"]) => NewTicket = (seeded) => ({
    customerId: seeded.customerId,
  }),
): MatrixRow[] => [
  {
    ...route,
    rule: "A ticket in the agents' brand: active staff of every role",
    expected: staffOnly(success),
    arrange: async ({ seeded, newTicket }) => ({
      params: { ticketId: await newTicket(ticket(seeded)) },
    }),
  },
  {
    ...route,
    rule: "A ticket in a brand none of them belongs to: 404, as if it didn't exist",
    expected: staffOnly(404),
    arrange: async ({ seeded, newTicket, otherBrandId }) => ({
      params: {
        ticketId: await newTicket({
          ...ticket(seeded),
          brandId: await otherBrandId(),
        }),
      },
    }),
  },
];

/** The same rows for a route on one of the ticket's files: every cell's ticket gets one. */
const withFile = (rows: MatrixRow[]): MatrixRow[] =>
  rows.map((row) => ({
    ...row,
    arrange: async (fixtures) => {
      const cell = (await row.arrange?.(fixtures)) ?? {};
      const ticketId = cell.params?.ticketId ?? "";
      return {
        ...cell,
        params: {
          ...cell.params,
          attachmentId: await fixtures.newAttachment(ticketId),
        },
      };
    },
  }));

/** Managers, the staff with `user:read` and `user:manage`, get `status`; agents 403. */
const managersOnly = (status: number): Record<Actor, number> => ({
  ...staffOnly(status),
  agent: 403,
});

/**
 * Agent management (FR-14). Each cell acts on a fresh colleague of the
 * agent rank, which both supervisors and admins outrank, so the rows test
 * the permission boundary; the rank rules have their own tests.
 */
const AGENT_ROWS: MatrixRow[] = [
  {
    method: "GET",
    path: "/api/v1/staff/agents",
    rule: "Listing colleagues needs user:read (supervisors, admins)",
    expected: managersOnly(200),
  },
  {
    method: "GET",
    path: "/api/v1/staff/agents/:agentId",
    rule: "One colleague needs user:read",
    expected: managersOnly(200),
    arrange: async ({ newAgent }) => ({
      params: { agentId: await newAgent() },
    }),
  },
  {
    method: "GET",
    path: "/api/v1/staff/agents/:agentId",
    rule: "A colleague in a brand none of the actors belong to is a 404, for managers too",
    expected: managersOnly(404),
    arrange: async ({ newAgent, otherBrandId }) => ({
      params: { agentId: await newAgent({ brandIds: [await otherBrandId()] }) },
    }),
  },
  {
    method: "POST",
    path: "/api/v1/staff/agents",
    rule: "Inviting needs user:manage",
    expected: managersOnly(201),
    arrange: () =>
      Promise.resolve({
        body: {
          email: `matrix-${randomUUID()}@dsd.example`,
          displayName: "Matrix Invite",
          role: "agent",
        },
      }),
  },
  {
    method: "PATCH",
    path: "/api/v1/staff/agents/:agentId",
    body: { displayName: "Renamed by the matrix" },
    rule: "Renaming needs user:manage",
    expected: managersOnly(200),
    arrange: async ({ newAgent }) => ({
      params: { agentId: await newAgent() },
    }),
  },
  {
    method: "PATCH",
    path: "/api/v1/staff/agents/:agentId/role",
    body: { role: "supervisor" },
    rule: "Changing a role needs user:manage",
    expected: managersOnly(200),
    arrange: async ({ newAgent }) => ({
      params: { agentId: await newAgent() },
    }),
  },
  {
    method: "PATCH",
    path: "/api/v1/staff/agents/:agentId/role",
    body: { role: "agent" },
    rule: "A supervisor's role: only an admin outranks them (rank rules)",
    expected: { ...managersOnly(200), supervisor: 403 },
    arrange: async ({ newAgent }) => ({
      params: { agentId: await newAgent({ role: "supervisor" }) },
    }),
  },
  {
    method: "POST",
    path: "/api/v1/staff/agents/:agentId/deactivate",
    rule: "Deactivating needs user:manage",
    expected: managersOnly(200),
    arrange: async ({ newAgent }) => ({
      params: { agentId: await newAgent() },
    }),
  },
  {
    method: "POST",
    path: "/api/v1/staff/agents/:agentId/reactivate",
    rule: "Reactivating needs user:manage",
    expected: managersOnly(200),
    arrange: async ({ newAgent }) => ({
      params: { agentId: await newAgent({ active: false }) },
    }),
  },
  {
    method: "POST",
    path: "/api/v1/staff/agents/:agentId/invite",
    rule: "Sending an invite again needs user:manage",
    expected: managersOnly(202),
    arrange: async ({ newAgent }) => ({
      params: { agentId: await newAgent({ hasPassword: false }) },
    }),
  },
];

/** A fresh draft's ID as the `:articleId` parameter. */
const onNewDraft = async ({ newArticle }: Fixtures): Promise<Cell> => ({
  params: { articleId: (await newArticle()).id },
});

/**
 * The knowledge base (FR-4, FR-15). Public routes answer everyone alike;
 * staff routes need `kb:read` to read, and `kb:write` or `kb:publish`,
 * which agents lack, to change anything.
 */
const KB_ROWS: MatrixRow[] = [
  {
    method: "GET",
    path: "/api/v1/public/kb/articles",
    rule: "The help centre is public; a session changes nothing",
    expected: forEveryone(200),
  },
  {
    method: "GET",
    path: "/api/v1/public/kb/articles/:slug",
    rule: "A published article is public",
    expected: forEveryone(200),
    arrange: async ({ newArticle }) => ({
      params: { slug: (await newArticle({ status: "published" })).slug },
    }),
  },
  {
    method: "GET",
    path: "/api/v1/public/kb/articles/:slug",
    rule: "A draft is a 404 for everyone, staff sessions included",
    expected: forEveryone(404),
    arrange: async ({ newArticle }) => ({
      params: { slug: (await newArticle()).slug },
    }),
  },
  {
    method: "GET",
    path: "/api/v1/public/kb/categories",
    rule: "Categories are public",
    expected: forEveryone(200),
  },
  {
    method: "GET",
    path: "/api/v1/staff/kb/articles",
    rule: "Every agent reads the knowledge base, drafts included (kb:read)",
    expected: staffOnly(200),
  },
  {
    method: "GET",
    path: "/api/v1/staff/kb/articles/:articleId",
    rule: "A draft in the actors' brand (kb:read)",
    expected: staffOnly(200),
    arrange: onNewDraft,
  },
  {
    method: "GET",
    path: "/api/v1/staff/kb/articles/:articleId",
    rule: "An article in a brand none of the actors belong to is a 404",
    expected: staffOnly(404),
    arrange: async ({ newArticle, otherBrandId }) => ({
      params: {
        articleId: (await newArticle({ brandId: await otherBrandId() })).id,
      },
    }),
  },
  {
    method: "POST",
    path: "/api/v1/staff/kb/articles",
    rule: "Writing needs kb:write",
    expected: managersOnly(201),
    arrange: () =>
      Promise.resolve({
        body: {
          title: "Written by the matrix",
          slug: `matrix-${randomUUID()}`,
          bodyMarkdown: "Text.",
        },
      }),
  },
  {
    method: "PATCH",
    path: "/api/v1/staff/kb/articles/:articleId",
    body: { title: "Edited by the matrix" },
    rule: "Editing needs kb:write",
    expected: managersOnly(200),
    arrange: onNewDraft,
  },
  ...(["publish", "archive"] as const).map((action): MatrixRow => ({
    method: "POST",
    path: `/api/v1/staff/kb/articles/:articleId/${action}`,
    rule: `Needs kb:publish (${action})`,
    expected: managersOnly(200),
    arrange: onNewDraft,
  })),
  {
    method: "POST",
    path: "/api/v1/staff/kb/articles/:articleId/unpublish",
    rule: "Needs kb:publish (unpublish)",
    expected: managersOnly(200),
    arrange: async ({ newArticle }) => ({
      params: { articleId: (await newArticle({ status: "published" })).id },
    }),
  },
  {
    method: "GET",
    path: "/api/v1/staff/kb/categories",
    rule: "Every agent reads the categories (kb:read)",
    expected: staffOnly(200),
  },
  {
    method: "POST",
    path: "/api/v1/staff/kb/categories",
    rule: "Adding a category needs kb:write",
    expected: managersOnly(201),
    arrange: () =>
      Promise.resolve({
        body: { name: "Matrix category", slug: `matrix-${randomUUID()}` },
      }),
  },
  {
    method: "PATCH",
    path: "/api/v1/staff/kb/categories/:categoryId",
    body: { name: "Renamed by the matrix" },
    rule: "Changing a category needs kb:write",
    expected: managersOnly(200),
    arrange: async ({ newCategory }) => ({
      params: { categoryId: await newCategory() },
    }),
  },
  {
    method: "DELETE",
    path: "/api/v1/staff/kb/categories/:categoryId",
    rule: "Deleting an empty category needs kb:write",
    expected: managersOnly(204),
    arrange: async ({ newCategory }) => ({
      params: { categoryId: await newCategory() },
    }),
  },
];

/**
 * Canned responses (FR-12): every agent uses them (`canned:use`); only
 * supervisors and admins write and retire them (`canned:manage`).
 */
const CANNED_ROWS: MatrixRow[] = [
  {
    method: "GET",
    path: "/api/v1/staff/canned-responses",
    rule: "Every agent lists templates (canned:use)",
    expected: staffOnly(200),
  },
  {
    method: "GET",
    path: "/api/v1/staff/canned-responses/:cannedResponseId/render",
    rule: "Every agent fills a template in for a ticket in their brand (canned:use)",
    expected: staffOnly(200),
    arrange: async ({ newCannedResponse, newTicket, seeded }) => ({
      params: { cannedResponseId: await newCannedResponse() },
      query: {
        ticketId: await newTicket({ customerId: seeded.customerId }),
      },
    }),
  },
  {
    method: "POST",
    path: "/api/v1/staff/canned-responses",
    rule: "Writing a template needs canned:manage",
    expected: managersOnly(201),
    arrange: () =>
      Promise.resolve({
        body: { title: `Matrix ${randomUUID()}`, body: "Hi {{customer.name}}" },
      }),
  },
  {
    method: "PATCH",
    path: "/api/v1/staff/canned-responses/:cannedResponseId",
    body: { body: "Edited by the matrix" },
    rule: "Editing a template needs canned:manage",
    expected: managersOnly(200),
    arrange: async ({ newCannedResponse }) => ({
      params: { cannedResponseId: await newCannedResponse() },
    }),
  },
  {
    method: "POST",
    path: "/api/v1/staff/canned-responses/:cannedResponseId/retire",
    rule: "Retiring a template needs canned:manage",
    expected: managersOnly(200),
    arrange: async ({ newCannedResponse }) => ({
      params: { cannedResponseId: await newCannedResponse() },
    }),
  },
];

export const MATRIX: readonly MatrixRow[] = [
  {
    method: "GET",
    path: "/health",
    rule: "Infrastructure: public",
    expected: forEveryone(200),
  },
  {
    method: "GET",
    path: "/ready",
    rule: "Infrastructure: public",
    expected: forEveryone(200),
  },

  publicForm("/api/v1/auth/customer/login", "Sign-in needs no session"),
  publicForm("/api/v1/auth/customer/signup", "Sign-up needs no session"),
  publicForm(
    "/api/v1/auth/customer/signup/complete",
    "The emailed link is the credential",
  ),
  publicForm(
    "/api/v1/auth/customer/guest-access/request",
    "Asking for a link needs no session",
  ),
  publicForm(
    "/api/v1/auth/customer/guest-access/exchange",
    "The emailed link is the credential",
  ),
  {
    method: "GET",
    path: "/api/v1/auth/customer/me",
    rule: "Any customer session, guests included; never a staff session",
    expected: customersOnly(200),
  },
  {
    method: "POST",
    path: "/api/v1/auth/customer/logout",
    rule: "Any customer session, guests included; never a staff session",
    expected: customersOnly(204),
  },

  publicForm("/api/v1/auth/staff/login", "Sign-in needs no session"),
  publicForm(
    "/api/v1/auth/staff/invite/complete",
    "The emailed link is the credential",
  ),
  {
    method: "GET",
    path: "/api/v1/auth/staff/me",
    rule: "Any active staff session; never a customer or a deactivated agent",
    expected: staffOnly(200),
  },
  {
    method: "POST",
    path: "/api/v1/auth/staff/logout",
    rule: "Any active staff session; never a customer or a deactivated agent",
    expected: staffOnly(204),
  },

  {
    method: "POST",
    path: "/api/v1/public/tickets",
    form: { subject: "" },
    rule: "Anyone may raise a ticket; the same invalid form gives every caller 400",
    expected: forEveryone(400),
  },
  {
    method: "POST",
    path: "/api/v1/customer/tickets",
    form: { subject: "Raised by the matrix", description: "An RBAC check" },
    rule: "Signed-in customers; a guest session sees one ticket and can't raise more",
    expected: { ...customersOnly(201), guest: 403 },
  },
  {
    method: "GET",
    path: "/api/v1/customer/tickets",
    rule: "Any customer session, guests included; each lists only its own",
    expected: customersOnly(200),
  },
  ...onCustomerTickets(
    { method: "GET", path: "/api/v1/customer/tickets/:ticketId" },
    200,
  ),
  ...onCustomerTickets(
    {
      method: "POST",
      path: "/api/v1/customer/tickets/:ticketId/messages",
      form: { body: "A reply sent by the RBAC matrix" },
    },
    201,
  ),
  ...withFile(
    onCustomerTickets(
      {
        method: "GET",
        path: "/api/v1/customer/tickets/:ticketId/attachments/:attachmentId",
      },
      200,
    ),
  ),

  {
    method: "GET",
    path: "/api/v1/staff/tickets",
    rule: "The queue: active staff of every role (ticket:read:any)",
    expected: staffOnly(200),
  },
  ...onStaffTickets(
    { method: "GET", path: "/api/v1/staff/tickets/:ticketId" },
    200,
  ),
  ...onStaffTickets(
    {
      method: "POST",
      path: "/api/v1/staff/tickets/:ticketId/replies",
      form: { body: "A reply sent by the RBAC matrix" },
    },
    201,
  ),
  ...onStaffTickets(
    {
      method: "POST",
      path: "/api/v1/staff/tickets/:ticketId/notes",
      form: { body: "A note written by the RBAC matrix" },
    },
    201,
  ),
  ...onStaffTickets(
    {
      method: "PATCH",
      path: "/api/v1/staff/tickets/:ticketId/status",
      body: { status: "pending_customer" },
    },
    200,
  ),
  ...onStaffTickets(
    {
      method: "PATCH",
      path: "/api/v1/staff/tickets/:ticketId/priority",
      body: { priority: "high" },
    },
    200,
  ),
  ...onStaffTickets(
    {
      method: "POST",
      path: "/api/v1/staff/tickets/:ticketId/assignment",
      body: { action: "claim" },
    },
    200,
  ),
  {
    method: "POST",
    path: "/api/v1/staff/tickets/:ticketId/assignment",
    body: { action: "unassign" },
    rule: "A colleague's ticket: only ticket:reassign:any (supervisors, admins) may take it away (FR-11)",
    expected: { ...staffOnly(200), agent: 403 },
    arrange: async ({ seeded, newTicket }) => ({
      params: {
        ticketId: await newTicket({
          customerId: seeded.customerId,
          assigneeId: seeded.colleagueId,
        }),
      },
    }),
  },
  ...onStaffTickets(
    {
      method: "POST",
      path: "/api/v1/staff/tickets/:ticketId/escalate",
      body: { reason: "Escalated by the RBAC matrix" },
    },
    200,
  ),
  ...onStaffTickets(
    { method: "GET", path: "/api/v1/staff/tickets/:ticketId/audit-events" },
    200,
  ),
  ...withFile(
    onStaffTickets(
      {
        method: "GET",
        path: "/api/v1/staff/tickets/:ticketId/attachments/:attachmentId",
      },
      200,
    ),
  ),
  {
    method: "GET",
    path: "/api/v1/staff/customers/:customerId",
    rule: "A customer with tickets in the agents' brand (customer:read)",
    expected: staffOnly(200),
    arrange: ({ seeded }) =>
      Promise.resolve({ params: { customerId: seeded.customerId } }),
  },
  ...AGENT_ROWS,
  ...KB_ROWS,
  ...CANNED_ROWS,
];
