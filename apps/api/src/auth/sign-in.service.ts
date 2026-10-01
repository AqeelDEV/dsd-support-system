import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { type LoginRequest, normalizeEmail, permissionsFor } from "@dsd/shared";

import type { Executor } from "../infrastructure/database.js";
import { DB } from "../infrastructure/tokens.js";
import { type Account, AccountsRepository } from "./accounts.repository.js";
import { PasswordHasher } from "./password-hasher.js";
import type { CustomerPrincipal, StaffPrincipal } from "./principal.js";
import {
  type ClientInfo,
  type IssuedSession,
  SessionService,
} from "./sessions/session.service.js";

/** One message for every failure, so it never says which part was wrong. */
const INCORRECT = "The email or password is incorrect.";

export interface SignedIn<P> {
  session: IssuedSession;
  principal: P;
}

/**
 * Password sign-in for both realms (ADR-0003). The realms stay separate:
 * each has its own endpoint, identity table and session realm, and these
 * methods share only the password check.
 */
@Injectable()
export class SignInService {
  private readonly logger = new Logger("SignIn");

  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly accounts: AccountsRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
  ) {}

  /**
   * A guest (no password yet) fails exactly like a wrong password. Any
   * session the browser already had in this realm is revoked, and a new
   * one is always created, so a session can't be planted before sign-in.
   */
  async customer(
    credentials: LoginRequest,
    client: ClientInfo,
    replacing: string | undefined,
  ): Promise<SignedIn<CustomerPrincipal>> {
    const account = await this.accounts.customerByEmail(
      normalizeEmail(credentials.email),
    );
    const rehashed = await this.checkPassword(
      account,
      credentials.password,
      "customer",
      client,
    );
    if (account === undefined) throw new UnauthorizedException(INCORRECT);

    if (replacing !== undefined) await this.sessions.revokeToken(replacing);
    const session = await this.db.transaction(async (tx) => {
      await this.accounts.recordCustomerLogin(tx, account.id, rehashed);
      return this.sessions.create(
        { kind: "customer", customerId: account.id },
        client,
        tx,
      );
    });
    return {
      session,
      principal: {
        realm: "customer",
        sessionId: session.id,
        customer: {
          id: account.id,
          email: account.email,
          displayName: account.displayName,
        },
        guestTicketId: null,
      },
    };
  }

  /** A deactivated agent, or one who hasn't accepted their invite, fails like a wrong password. */
  async staff(
    credentials: LoginRequest,
    client: ClientInfo,
    replacing: string | undefined,
  ): Promise<SignedIn<StaffPrincipal>> {
    const account = await this.accounts.agentByEmail(
      normalizeEmail(credentials.email),
    );
    const active = account?.deactivatedAt === null ? account : undefined;
    const rehashed = await this.checkPassword(
      active,
      credentials.password,
      "staff",
      client,
    );
    if (active === undefined) throw new UnauthorizedException(INCORRECT);

    if (replacing !== undefined) await this.sessions.revokeToken(replacing);
    const session = await this.db.transaction(async (tx) => {
      await this.accounts.recordAgentLogin(tx, active.id, rehashed);
      return this.sessions.create(
        { kind: "staff", agentId: active.id },
        client,
        tx,
      );
    });
    return {
      session,
      principal: {
        realm: "staff",
        sessionId: session.id,
        agent: {
          id: active.id,
          email: active.email,
          displayName: active.displayName,
          role: active.role,
        },
        permissions: new Set(permissionsFor(active.role)),
      },
    };
  }

  /**
   * Verifies the password, spending the same time whether or not the
   * account exists. Throws 401 on failure. On success, returns a fresh hash
   * if the stored one used outdated parameters, which is the only moment
   * the plain password is available to upgrade it.
   */
  private async checkPassword(
    account: Account | undefined,
    password: string,
    realm: "customer" | "staff",
    client: ClientInfo,
  ): Promise<string | undefined> {
    const stored = account?.passwordHash ?? null;
    const matches = await this.hasher.verify(stored, password);
    if (!matches || stored === null) {
      // Never the email or the password: the realm and address are enough
      // to spot a guessing run in the logs.
      this.logger.log({ realm, ip: client.ip }, "Sign-in failed");
      throw new UnauthorizedException(INCORRECT);
    }
    return this.hasher.needsRehash(stored)
      ? this.hasher.hash(password)
      : undefined;
  }
}
