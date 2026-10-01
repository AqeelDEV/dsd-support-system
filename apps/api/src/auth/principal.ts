import type { AgentRole, Permission } from "@dsd/shared";

/** Who is calling, as established from the session cookie for this route's realm. */
export type Principal = CustomerPrincipal | StaffPrincipal;

export interface CustomerPrincipal {
  realm: "customer";
  sessionId: string;
  customer: { id: string; email: string; displayName: string | null };
  /**
   * Set for a guest session, which may see this one ticket and nothing
   * else (ADR-0003, section 6). Customer-realm queries filter on it.
   */
  guestTicketId: string | null;
}

export interface StaffPrincipal {
  realm: "staff";
  sessionId: string;
  agent: { id: string; email: string; displayName: string; role: AgentRole };
  /** Resolved from the agent's current role on every request, so a role change applies at once. */
  permissions: ReadonlySet<Permission>;
}
