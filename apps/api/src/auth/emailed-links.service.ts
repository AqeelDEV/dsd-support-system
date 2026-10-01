import { Inject, Injectable } from "@nestjs/common";
import {
  type GuestAccessRequest,
  type InviteCompleteRequest,
  normalizeEmail,
  type PasswordResetCompleteRequest,
  permissionsFor,
  PROBLEM_TYPES,
  type SignupCompleteRequest,
} from "@dsd/shared";

import { ProblemException } from "../common/problem-details.js";
import type { Executor } from "../infrastructure/database.js";
import { DB } from "../infrastructure/tokens.js";
import { CustomersRepository } from "../modules/customers/customers.repository.js";
import { OutboxRepository } from "../modules/outbox/outbox.repository.js";
import { EmailedLinksRepository } from "./emailed-links.repository.js";
import { PasswordHasher } from "./password-hasher.js";
import type { CustomerPrincipal, StaffPrincipal } from "./principal.js";
import { type ClientInfo, SessionService } from "./sessions/session.service.js";
import type { SignedIn } from "./sign-in.service.js";
import { hashToken } from "./tokens.js";

const invalidLink = () =>
  new ProblemException(
    400,
    PROBLEM_TYPES.invalidToken,
    "This link is invalid, has expired or has already been used. Ask for a new one.",
  );

/**
 * Everything done through an emailed link (ADR-0003, sections 6 to 8):
 * customers' email-first sign-up and guest access to one ticket, and
 * agents accepting an invite. The API only records that a link is wanted,
 * as an outbox event; the worker creates the token when it sends the email,
 * so no raw token is ever stored.
 */
@Injectable()
export class EmailedLinksService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly links: EmailedLinksRepository,
    private readonly customers: CustomersRepository,
    private readonly outbox: OutboxRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionService,
  ) {}

  /**
   * Starts registration. The same answer comes back whether or not the
   * email has an account; the email itself says which. No password is
   * accepted here, so nobody can set one for an inbox they don't control
   * (account pre-hijacking).
   */
  async requestSignup(email: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const customerId = await this.customers.findOrCreate(
        tx,
        email.trim(),
        normalizeEmail(email),
      );
      await this.outbox.add(tx, {
        type: "customer.signup_requested",
        aggregateType: "customer",
        aggregateId: customerId,
        payload: { customerId },
      });
    });
  }

  /**
   * Finishes registration from the emailed link: the first password, the
   * verified email and the name go on the customer's existing row, so their
   * guest tickets are already in the account. Then it signs them in.
   */
  async completeSignup(
    request: SignupCompleteRequest,
    client: ClientInfo,
    replacing: string | undefined,
  ): Promise<SignedIn<CustomerPrincipal>> {
    // Hashing is slow, so it happens before the transaction opens.
    const passwordHash = await this.hasher.hash(request.password);
    return this.thenRevoke(replacing, () =>
      this.db.transaction(async (tx) => {
        const token = await this.links.consumeSignupToken(
          tx,
          hashToken(request.token),
        );
        if (token === undefined) throw invalidLink();
        // An account that already has a password is never changed this way;
        // the rollback also leaves the token as it was.
        const customer = await this.links.completeRegistration(
          tx,
          token.customerId,
          { passwordHash, displayName: request.displayName },
        );
        if (customer === undefined) throw invalidLink();
        const session = await this.sessions.create(
          { kind: "customer", customerId: customer.id },
          client,
          tx,
        );
        return {
          session,
          principal: {
            realm: "customer",
            sessionId: session.id,
            customer,
            guestTicketId: null,
          },
        };
      }),
    );
  }

  /**
   * Asks for a fresh guest link. It answers the same way whether or not the
   * email and reference match, so it can't be used to find out which
   * addresses have tickets.
   */
  async requestGuestLink(request: GuestAccessRequest): Promise<void> {
    const ticket = await this.links.ticketOf(
      normalizeEmail(request.email),
      request.reference.toUpperCase(),
    );
    if (ticket === undefined) return;
    await this.db.transaction(async (tx) => {
      await this.outbox.add(tx, {
        type: "guest_access.requested",
        aggregateType: "ticket",
        aggregateId: ticket.ticketId,
        payload: { ticketId: ticket.ticketId, customerId: ticket.customerId },
      });
    });
  }

  /**
   * Sets an invited agent's first password from the emailed invite and
   * signs them in. Staff can't register themselves; a supervisor or admin
   * creates the agent and the invite (Phase 5).
   */
  async acceptInvite(
    request: InviteCompleteRequest,
    client: ClientInfo,
    replacing: string | undefined,
  ): Promise<SignedIn<StaffPrincipal>> {
    const passwordHash = await this.hasher.hash(request.password);
    return this.thenRevoke(replacing, () =>
      this.db.transaction(async (tx) => {
        const token = await this.links.consumeInviteToken(
          tx,
          hashToken(request.token),
        );
        if (token === undefined) throw invalidLink();
        const agent = await this.links.acceptInvite(
          tx,
          token.agentId,
          passwordHash,
        );
        if (agent === undefined) throw invalidLink();
        const session = await this.sessions.create(
          { kind: "staff", agentId: agent.id },
          client,
          tx,
        );
        return {
          session,
          principal: {
            realm: "staff",
            sessionId: session.id,
            agent,
            permissions: new Set(permissionsFor(agent.role)),
          },
        };
      }),
    );
  }

  /**
   * Asks the worker to email a reset link. It answers the same way whether
   * or not the address has an account, so it can't be used to find out
   * who does; the email itself says what to do. An unknown address gets
   * nothing, because there is nobody to write to.
   */
  async requestPasswordReset(email: string): Promise<void> {
    const customerId = await this.links.customerIdByEmail(
      normalizeEmail(email),
    );
    if (customerId === undefined) return;
    await this.db.transaction(async (tx) => {
      await this.outbox.add(tx, {
        type: "customer.password_reset_requested",
        aggregateType: "customer",
        aggregateId: customerId,
        payload: { customerId },
      });
    });
  }

  /**
   * Sets a new password from the emailed link (ADR-0003, amended). Every
   * session the customer had is revoked, guest sessions included, other
   * reset links stop working, and this browser is signed in afresh.
   */
  async completePasswordReset(
    request: PasswordResetCompleteRequest,
    client: ClientInfo,
    replacing: string | undefined,
  ): Promise<SignedIn<CustomerPrincipal>> {
    const passwordHash = await this.hasher.hash(request.password);
    return this.thenRevoke(replacing, () =>
      this.db.transaction(async (tx) => {
        const token = await this.links.consumeResetToken(
          tx,
          hashToken(request.token),
        );
        if (token === undefined) throw invalidLink();
        const customer = await this.links.resetPassword(
          tx,
          token.customerId,
          passwordHash,
        );
        if (customer === undefined) throw invalidLink();
        await this.links.discardResetTokens(tx, customer.id);
        await this.sessions.revokeAllFor(tx, { customerId: customer.id });
        const session = await this.sessions.create(
          { kind: "customer", customerId: customer.id },
          client,
          tx,
        );
        return {
          session,
          principal: {
            realm: "customer",
            sessionId: session.id,
            customer,
            guestTicketId: null,
          },
        };
      }),
    );
  }

  /**
   * Turns a guest link into a guest session that can see that one ticket.
   * Opening the link proves the customer owns the address, so the ticket's
   * contact is marked verified for the agents.
   */
  async exchangeGuestLink(
    token: string,
    client: ClientInfo,
    replacing: string | undefined,
  ): Promise<SignedIn<CustomerPrincipal>> {
    return this.thenRevoke(replacing, () =>
      this.db.transaction(async (tx) => {
        const link = await this.links.useGuestToken(tx, hashToken(token));
        if (link === undefined) throw invalidLink();
        await this.links.markContactVerified(tx, link.ticketId);
        const customer = await this.links.customer(tx, link.customerId);
        if (customer === undefined) throw invalidLink();
        const session = await this.sessions.create(
          { kind: "guest", customerId: customer.id, ticketId: link.ticketId },
          client,
          tx,
        );
        return {
          session,
          principal: {
            realm: "customer",
            sessionId: session.id,
            customer,
            guestTicketId: link.ticketId,
          },
        };
      }),
    );
  }

  /**
   * Signs in through `signIn`, and only then revokes the session the
   * browser already had. A failed attempt, such as an expired link, leaves
   * that session alone.
   */
  private async thenRevoke<P>(
    replacing: string | undefined,
    signIn: () => Promise<SignedIn<P>>,
  ): Promise<SignedIn<P>> {
    const signedIn = await signIn();
    if (replacing !== undefined) await this.sessions.revokeToken(replacing);
    return signedIn;
  }
}
