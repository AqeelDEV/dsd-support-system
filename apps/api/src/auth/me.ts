import type { CustomerMe, StaffMe } from "@dsd/shared";

import type { CustomerPrincipal, StaffPrincipal } from "./principal.js";

/** The `/auth/customer/me` body: who is signed in, and the token for unsafe requests. */
export function customerMe(
  principal: CustomerPrincipal,
  csrfToken: string,
): CustomerMe {
  return {
    customer: principal.customer,
    guestTicketId: principal.guestTicketId,
    csrfToken,
  };
}

/**
 * The `/auth/staff/me` body. The agent app shows or hides controls from
 * `permissions` and never evaluates a rule itself (ADR-0004, section 5).
 */
export function staffMe(principal: StaffPrincipal, csrfToken: string): StaffMe {
  return {
    agent: principal.agent,
    permissions: [...principal.permissions],
    csrfToken,
  };
}
