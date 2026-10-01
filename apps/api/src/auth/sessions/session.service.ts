import { isIP } from "node:net";

import { Inject, Injectable } from "@nestjs/common";
import { permissionsFor, type SessionRealm } from "@dsd/shared";

import type { Env } from "../../config/env.js";
import type { Executor } from "../../infrastructure/database.js";
import { ENV } from "../../infrastructure/tokens.js";
import type { Principal } from "../principal.js";
import { generateToken, hashToken } from "../tokens.js";
import { SessionRepository } from "./session.repository.js";

/** Which lifetime a session gets (ADR-0003, section 2). */
export type SessionKind = "staff" | "customer" | "guest";

export type SessionSubject =
  | { kind: "staff"; agentId: string }
  | { kind: "customer"; customerId: string }
  | { kind: "guest"; customerId: string; ticketId: string };

export interface ClientInfo {
  ip: string | undefined;
  userAgent: string | undefined;
}

export interface IssuedSession {
  /** The raw token. It goes into the cookie and is never stored. */
  token: string;
  id: string;
  realm: SessionRealm;
  expiresAt: Date;
}

interface Lifetime {
  maxAgeMinutes: number;
  idleMinutes: number;
}

/** Plenty for any real browser; anything longer is cut, not refused. */
const USER_AGENT_MAX = 512;

/**
 * Opaque database sessions (ADR-0003). Every sign-in gets a new token, so a
 * session can't be planted before sign-in, and revocation applies on the
 * very next request.
 */
@Injectable()
export class SessionService {
  private readonly lifetimes: Record<SessionKind, Lifetime>;

  constructor(
    private readonly sessions: SessionRepository,
    @Inject(ENV) env: Env,
  ) {
    this.lifetimes = {
      staff: {
        maxAgeMinutes: env.STAFF_SESSION_MAX_AGE_MINUTES,
        idleMinutes: env.STAFF_SESSION_IDLE_MINUTES,
      },
      customer: {
        maxAgeMinutes: env.CUSTOMER_SESSION_MAX_AGE_MINUTES,
        idleMinutes: env.CUSTOMER_SESSION_IDLE_MINUTES,
      },
      guest: {
        maxAgeMinutes: env.GUEST_SESSION_MAX_AGE_MINUTES,
        idleMinutes: env.GUEST_SESSION_IDLE_MINUTES,
      },
    };
  }

  async create(
    subject: SessionSubject,
    client: ClientInfo,
    executor?: Executor,
  ): Promise<IssuedSession> {
    const token = generateToken();
    const realm: SessionRealm = subject.kind === "staff" ? "staff" : "customer";
    const row = await this.sessions.insert(
      {
        realm,
        tokenHash: hashToken(token),
        ...(subject.kind === "staff"
          ? { agentId: subject.agentId }
          : { customerId: subject.customerId }),
        ...(subject.kind === "guest"
          ? { guestTicketId: subject.ticketId }
          : {}),
        ip: client.ip !== undefined && isIP(client.ip) !== 0 ? client.ip : null,
        userAgent: client.userAgent?.slice(0, USER_AGENT_MAX) ?? null,
        ...this.lifetimes[subject.kind],
      },
      executor,
    );
    return { token, id: row.id, realm, expiresAt: row.expiresAt };
  }

  /**
   * The principal behind `token`, or null if the token is unknown, revoked,
   * expired, idle, from the other realm, or belongs to a deactivated agent.
   * A customer token sent in the staff cookie is found, then refused here,
   * because the realm on the session row is what counts.
   */
  async resolve(realm: SessionRealm, token: string): Promise<Principal | null> {
    const row = await this.sessions.findLive(hashToken(token));
    if (row?.realm !== realm) return null;

    let principal: Principal;
    let kind: SessionKind;
    if (realm === "staff") {
      // No agent, or a deactivated one.
      if (row.agent?.deactivatedAt !== null) return null;
      const { deactivatedAt: _, ...agent } = row.agent;
      principal = {
        realm,
        sessionId: row.id,
        agent,
        permissions: new Set(permissionsFor(agent.role)),
      };
      kind = "staff";
    } else {
      if (row.customer === null) return null;
      principal = {
        realm,
        sessionId: row.id,
        customer: row.customer,
        guestTicketId: row.guestTicketId,
      };
      kind = row.guestTicketId === null ? "customer" : "guest";
    }

    if (Date.now() - row.lastSeenAt.getTime() >= 60_000) {
      await this.sessions.touch(row.id, this.lifetimes[kind].idleMinutes);
    }
    return principal;
  }

  revoke(sessionId: string): Promise<void> {
    return this.sessions.revoke(sessionId);
  }

  /** Signs one identity out everywhere, inside the caller's transaction. */
  revokeAllFor(
    executor: Executor,
    identity: { agentId: string } | { customerId: string },
  ): Promise<void> {
    return this.sessions.revokeAllFor(executor, identity);
  }

  /** Revokes whatever session `token` names, if any. Used when a browser signs in again. */
  revokeToken(token: string): Promise<void> {
    return this.sessions.revokeByTokenHash(hashToken(token));
  }
}
