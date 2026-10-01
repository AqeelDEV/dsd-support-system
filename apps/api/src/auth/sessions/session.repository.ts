import { Inject, Injectable } from "@nestjs/common";
import { agents, customers, sessions } from "@dsd/db/schema";
import type { SessionRealm } from "@dsd/shared";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";

export interface NewSession {
  realm: SessionRealm;
  tokenHash: Buffer;
  customerId?: string;
  agentId?: string;
  guestTicketId?: string;
  ip: string | null;
  userAgent: string | null;
  maxAgeMinutes: number;
  idleMinutes: number;
}

const minutesFromNow = (minutes: number) =>
  sql`now() + make_interval(mins => ${minutes})`;

/**
 * The `sessions` table. Expiry is always computed and compared with the
 * database clock, so API instances with drifting clocks still agree.
 */
@Injectable()
export class SessionRepository {
  constructor(@Inject(DB) private readonly db: Executor) {}

  async insert(
    session: NewSession,
    executor: Executor = this.db,
  ): Promise<{ id: string; expiresAt: Date }> {
    const [row] = await executor
      .insert(sessions)
      .values({
        realm: session.realm,
        tokenHash: session.tokenHash,
        customerId: session.customerId,
        agentId: session.agentId,
        guestTicketId: session.guestTicketId,
        ip: session.ip,
        userAgent: session.userAgent,
        expiresAt: minutesFromNow(session.maxAgeMinutes),
        idleExpiresAt: sql`least(${minutesFromNow(session.idleMinutes)}, ${minutesFromNow(session.maxAgeMinutes)})`,
      })
      .returning({ id: sessions.id, expiresAt: sessions.expiresAt });
    if (row === undefined) throw new Error("session insert returned nothing");
    return row;
  }

  /**
   * The live session for a token hash, with its identity. Revoked, expired
   * and idle sessions are filtered out here, so a caller can't forget to.
   */
  async findLive(tokenHash: Buffer) {
    const [row] = await this.db
      .select({
        id: sessions.id,
        realm: sessions.realm,
        guestTicketId: sessions.guestTicketId,
        lastSeenAt: sessions.lastSeenAt,
        customer: {
          id: customers.id,
          email: customers.email,
          displayName: customers.displayName,
        },
        agent: {
          id: agents.id,
          email: agents.email,
          displayName: agents.displayName,
          role: agents.role,
          deactivatedAt: agents.deactivatedAt,
        },
      })
      .from(sessions)
      .leftJoin(customers, eq(customers.id, sessions.customerId))
      .leftJoin(agents, eq(agents.id, sessions.agentId))
      .where(
        and(
          eq(sessions.tokenHash, tokenHash),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, sql`now()`),
          gt(sessions.idleExpiresAt, sql`now()`),
        ),
      )
      .limit(1);
    return row;
  }

  /**
   * Records activity and slides the idle deadline, never past the absolute
   * expiry. The WHERE clause makes it a no-op within a minute of the last
   * touch, so busy sessions don't write on every request.
   */
  async touch(id: string, idleMinutes: number): Promise<void> {
    await this.db
      .update(sessions)
      .set({
        lastSeenAt: sql`now()`,
        idleExpiresAt: sql`least(${minutesFromNow(idleMinutes)}, ${sessions.expiresAt})`,
      })
      .where(
        and(
          eq(sessions.id, id),
          lt(sessions.lastSeenAt, sql`now() - interval '1 minute'`),
        ),
      );
  }

  async revoke(id: string): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  }

  async revokeByTokenHash(tokenHash: Buffer): Promise<void> {
    await this.db
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(
        and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)),
      );
  }

  /**
   * Revokes every live session of one identity: a role change,
   * deactivation or password reset applies on the very next request
   * (ADR-0003, section 2). Runs in the caller's transaction.
   */
  async revokeAllFor(
    executor: Executor,
    identity: { agentId: string } | { customerId: string },
  ): Promise<void> {
    await executor
      .update(sessions)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          "agentId" in identity
            ? eq(sessions.agentId, identity.agentId)
            : eq(sessions.customerId, identity.customerId),
          isNull(sessions.revokedAt),
        ),
      );
  }
}
