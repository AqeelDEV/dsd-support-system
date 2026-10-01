import type { TestDatabase } from "@dsd/db/testing";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { DEMO, sessionCookie, sessionFor } from "../support/auth.js";
import { asOwner, idOf } from "../support/database.js";
import type { Actor } from "./matrix.js";

/** What a caller sends: its cookies and the CSRF token its pages would set. */
export interface CallerHeaders {
  cookie?: string;
  csrfToken?: string;
}

interface SeededIdentities {
  customerId: string;
  otherCustomerId: string;
  guest: { customerId: string; ticketId: string };
  agentIds: Record<"agent" | "supervisor" | "admin" | "formerAgent", string>;
}

/** The seeded people behind each actor. */
export async function identities(
  database: TestDatabase,
): Promise<SeededIdentities> {
  const [other] = await asOwner<{ id: string }>(
    database,
    `SELECT id FROM customers WHERE password_hash IS NOT NULL
        AND email_normalized <> $1 ORDER BY email_normalized LIMIT 1`,
    [DEMO.customer],
  );
  const [guest] = await asOwner<{ customer_id: string; id: string }>(
    database,
    `SELECT t.customer_id, t.id FROM tickets t
       JOIN customers c ON c.id = t.customer_id
      WHERE c.password_hash IS NULL ORDER BY t.number LIMIT 1`,
  );
  if (other === undefined || guest === undefined) {
    throw new Error("the seed lacks a second customer or a guest ticket");
  }
  return {
    customerId: await idOf(database, "customers", DEMO.customer),
    otherCustomerId: other.id,
    guest: { customerId: guest.customer_id, ticketId: guest.id },
    agentIds: {
      agent: await idOf(database, "agents", DEMO.agent),
      supervisor: await idOf(database, "agents", DEMO.supervisor),
      admin: await idOf(database, "agents", DEMO.admin),
      formerAgent: await idOf(database, "agents", DEMO.formerAgent),
    },
  };
}

/**
 * Fresh credentials for one matrix cell. Every cell gets its own session,
 * so a cell that signs out can't affect the next.
 */
export async function headersFor(
  app: NestFastifyApplication,
  seeded: SeededIdentities,
  actor: Actor,
): Promise<CallerHeaders> {
  const customer = (customerId: string) =>
    sessionFor(app, { kind: "customer", customerId });
  const staff = (agentId: string) =>
    sessionFor(app, { kind: "staff", agentId });

  switch (actor) {
    case "anonymous":
      return {};
    case "customer":
      return customer(seeded.customerId);
    case "otherCustomer":
      return customer(seeded.otherCustomerId);
    case "guest":
      return sessionFor(app, { kind: "guest", ...seeded.guest });
    case "agent":
    case "supervisor":
    case "admin":
      return staff(seeded.agentIds[actor]);
    case "deactivatedAgent":
      // The seed's former agent is deactivated; a session row for them is
      // what an old browser tab would still hold.
      return staff(seeded.agentIds.formerAgent);
    case "customerTokenInStaffCookie": {
      const planted = await customer(seeded.customerId);
      return {
        cookie: sessionCookie(app, "staff", planted.token),
        csrfToken: planted.csrfToken,
      };
    }
    case "staffTokenInCustomerCookie": {
      const planted = await staff(seeded.agentIds.admin);
      return {
        cookie: sessionCookie(app, "customer", planted.token),
        csrfToken: planted.csrfToken,
      };
    }
  }
}
