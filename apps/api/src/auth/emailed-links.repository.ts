import { Inject, Injectable } from "@nestjs/common";
import { agents, authTokens, customers, tickets } from "@dsd/db/schema";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { Executor } from "../infrastructure/database.js";
import { DB } from "../infrastructure/tokens.js";

/**
 * The rows behind emailed links: the tokens the worker created, and the
 * customers and tickets they open. Expiry is compared with the database
 * clock, and every check happens in the same statement that uses the
 * token, so two requests can't both spend a single-use token.
 */
@Injectable()
export class EmailedLinksRepository {
  constructor(@Inject(DB) private readonly db: Executor) {}

  /** Spends a single-use sign-up token; undefined if it is unknown, expired or used. */
  async consumeSignupToken(
    executor: Executor,
    tokenHash: Buffer,
  ): Promise<{ customerId: string } | undefined> {
    const [row] = await executor
      .update(authTokens)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "customer_signup"),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ customerId: authTokens.customerId });
    // The token table's CHECK guarantees a sign-up token names a customer.
    return row?.customerId ? { customerId: row.customerId } : undefined;
  }

  /** Spends a single-use invite token; undefined if it is unknown, expired or used. */
  async consumeInviteToken(
    executor: Executor,
    tokenHash: Buffer,
  ): Promise<{ agentId: string } | undefined> {
    const [row] = await executor
      .update(authTokens)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "agent_invite"),
          isNull(authTokens.consumedAt),
          gt(authTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({ agentId: authTokens.agentId });
    // The token table's CHECK guarantees an invite names an agent.
    return row?.agentId ? { agentId: row.agentId } : undefined;
  }

  /**
   * Sets an invited agent's first password, which also counts as their
   * first sign-in. Only for an active agent without a password: an invite
   * can't reset an existing account or revive a deactivated one.
   */
  async acceptInvite(
    executor: Executor,
    agentId: string,
    passwordHash: string,
  ) {
    const [row] = await executor
      .update(agents)
      .set({ passwordHash, lastLoginAt: sql`now()` })
      .where(
        and(
          eq(agents.id, agentId),
          isNull(agents.passwordHash),
          isNull(agents.deactivatedAt),
        ),
      )
      .returning({
        id: agents.id,
        email: agents.email,
        displayName: agents.displayName,
        role: agents.role,
      });
    return row;
  }

  /** Uses a guest link, which stays valid until it expires; undefined if it is unknown or expired. */
  async useGuestToken(
    executor: Executor,
    tokenHash: Buffer,
  ): Promise<{ customerId: string; ticketId: string } | undefined> {
    const [row] = await executor
      .update(authTokens)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(authTokens.tokenHash, tokenHash),
          eq(authTokens.purpose, "guest_ticket_access"),
          gt(authTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({
        customerId: authTokens.customerId,
        ticketId: authTokens.ticketId,
      });
    // The token table's CHECK guarantees a guest token names both.
    return row?.customerId && row.ticketId
      ? { customerId: row.customerId, ticketId: row.ticketId }
      : undefined;
  }

  /**
   * The customer for `emailNormalized`, created without a password if
   * there isn't one yet: the same row a guest ticket would use, which is
   * why earlier guest tickets appear once the account is registered.
   */
  async findOrCreateCustomer(
    executor: Executor,
    email: string,
    emailNormalized: string,
  ): Promise<string> {
    const [created] = await executor
      .insert(customers)
      .values({ email, emailNormalized })
      .onConflictDoNothing({ target: customers.emailNormalized })
      .returning({ id: customers.id });
    if (created !== undefined) return created.id;
    const [existing] = await executor
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.emailNormalized, emailNormalized));
    if (existing === undefined) {
      throw new Error("customer vanished between insert and select");
    }
    return existing.id;
  }

  /**
   * Sets the first password, marks the email verified and stores the name.
   * Only for a customer without a password: an account that already has
   * one is never changed through a sign-up link.
   */
  async completeRegistration(
    executor: Executor,
    customerId: string,
    details: { passwordHash: string; displayName: string },
  ) {
    const [row] = await executor
      .update(customers)
      .set({
        passwordHash: details.passwordHash,
        displayName: details.displayName,
        emailVerifiedAt: sql`coalesce(${customers.emailVerifiedAt}, now())`,
      })
      .where(and(eq(customers.id, customerId), isNull(customers.passwordHash)))
      .returning({
        id: customers.id,
        email: customers.email,
        displayName: customers.displayName,
      });
    return row;
  }

  async customer(executor: Executor, id: string) {
    const [row] = await executor
      .select({
        id: customers.id,
        email: customers.email,
        displayName: customers.displayName,
      })
      .from(customers)
      .where(eq(customers.id, id));
    return row;
  }

  /** Opening an emailed link proves the customer owns the address on the ticket. */
  async markContactVerified(executor: Executor, ticketId: string) {
    await executor
      .update(tickets)
      .set({ contactVerifiedAt: sql`now()` })
      .where(and(eq(tickets.id, ticketId), isNull(tickets.contactVerifiedAt)));
  }

  /** The ticket with `reference` if it belongs to the customer with `emailNormalized`. */
  async ticketOf(
    emailNormalized: string,
    reference: string,
  ): Promise<{ ticketId: string; customerId: string } | undefined> {
    const [row] = await this.db
      .select({ ticketId: tickets.id, customerId: tickets.customerId })
      .from(tickets)
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .where(
        and(
          eq(tickets.reference, reference),
          eq(customers.emailNormalized, emailNormalized),
        ),
      );
    return row;
  }
}
