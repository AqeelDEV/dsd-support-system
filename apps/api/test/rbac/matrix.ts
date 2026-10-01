/**
 * The RBAC matrix (ADR-0004, Verification): every route, crossed with every
 * kind of caller, with the status each must get. The route-coverage test
 * fails if a registered route is missing here, so no endpoint can ship
 * without someone deciding who may call it.
 *
 * Every request is sent the way our own pages would send it (a trusted
 * Origin, and the caller's own CSRF token), so a cell tests authorisation
 * and nothing else. Each phase adds the rows for its routes.
 */

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

export interface MatrixRow {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The path as registered, which for now has no parameters. */
  path: string;
  /** Sent with every request in this row. */
  body?: Record<string, unknown>;
  /** Why this row expects what it does, for whoever reads a failure. */
  rule: string;
  expected: Record<Actor, number>;
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
];
