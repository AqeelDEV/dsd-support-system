import type { Database } from "@dsd/db";
import {
  agentInvitedSchema,
  customerPasswordResetRequestedSchema,
  customerSignupRequestedSchema,
  type DomainEvent,
  guestAccessRequestedSchema,
  messageCreatedSchema,
  ticketCreatedSchema,
  ticketStatusChangedSchema,
} from "@dsd/shared";
import type { z } from "zod";

import type { Logger } from "../logger.js";
import type { OutboxJob } from "../outbox/dispatcher.js";
import type { Recipient } from "./channel.js";
import { createLinkToken, type Links } from "./links.js";
import type { NotificationService } from "./notification-service.js";
import {
  type NotificationsRepository,
  senderOf,
  type TicketForEmail,
} from "./notifications.repository.js";
import type { TicketLink } from "./templates.js";

/** A payload that doesn't match its event's schema can never succeed; retrying won't help. */
export class InvalidEventError extends Error {
  override name = "InvalidEventError";
}

function payloadOf<Schema extends z.ZodType>(
  schema: Schema,
  job: OutboxJob,
): z.output<Schema> {
  const parsed = schema.safeParse(job.payload);
  if (!parsed.success) {
    throw new InvalidEventError(
      `Invalid ${job.type} payload for ${job.eventId}`,
    );
  }
  return parsed.data;
}

const customerRecipient = (customer: {
  id: string;
  email: string;
}): Recipient => ({
  kind: "customer",
  customerId: customer.id,
  email: customer.email,
});

/**
 * Turns domain events into notifications (FR-5, FR-2; ADR-0005, section 7):
 *
 * - a new ticket: an acknowledgement with a link to it;
 * - a public agent reply: the reply, and the new status if the reply set
 *   one; internal notes and customers' own messages send nothing;
 * - a status change on its own: the new status;
 * - sign-up, a guest link, a password reset, an agent invite: the emailed
 *   link, with its token created as the email is sent.
 *
 * A ticket email links to the ticket page for a customer with an account,
 * and otherwise carries a fresh guest link, so the newest email always
 * works.
 */
export class NotificationHandlers {
  private readonly handlers: Partial<
    Record<DomainEvent, (job: OutboxJob) => Promise<void>>
  >;

  constructor(
    private readonly db: Database,
    private readonly data: NotificationsRepository,
    private readonly notifications: NotificationService,
    private readonly links: Links,
    private readonly publicBrandSlug: string,
    private readonly logger: Logger,
  ) {
    this.handlers = {
      "ticket.created": (job) => this.ticketCreated(job),
      "message.created": (job) => this.messageCreated(job),
      "ticket.status_changed": (job) => this.statusChanged(job),
      "guest_access.requested": (job) => this.guestAccess(job),
      "customer.signup_requested": (job) => this.signupRequested(job),
      "customer.password_reset_requested": (job) => this.resetRequested(job),
      "agent.invited": (job) => this.agentInvited(job),
    };
  }

  async handle(job: OutboxJob): Promise<void> {
    const handler = this.handlers[job.type];
    if (handler === undefined) {
      throw new InvalidEventError(`No notification for ${job.type}`);
    }
    await handler(job);
  }

  private async ticketCreated(job: OutboxJob): Promise<void> {
    const { ticketId } = payloadOf(ticketCreatedSchema, job);
    const ticket = await this.ticketOrSkip(ticketId, job);
    if (ticket === undefined) return;
    await this.notifications.notify({
      eventId: job.eventId,
      ticketId,
      recipient: customerRecipient(ticket.customer),
      from: senderOf(ticket.brand),
      template: "ticketReceived",
      data: async () => ({
        ...this.facts(ticket),
        link: await this.ticketLink(ticket),
      }),
    });
  }

  private async messageCreated(job: OutboxJob): Promise<void> {
    const event = payloadOf(messageCreatedSchema, job);
    if (event.authorType !== "agent" || event.visibility !== "public") return;
    const ticket = await this.ticketOrSkip(event.ticketId, job);
    if (ticket === undefined) return;
    const reply = await this.data.publicReply(event.messageId);
    if (reply === undefined) {
      this.logger.warn(
        { eventId: job.eventId },
        "no public agent reply for this event; nothing sent",
      );
      return;
    }
    const newStatus = await this.data.statusSetBy(event.messageId);
    await this.notifications.notify({
      eventId: job.eventId,
      ticketId: ticket.id,
      recipient: customerRecipient(ticket.customer),
      from: senderOf(ticket.brand),
      template: "agentReply",
      data: async () => ({
        ...this.facts(ticket),
        agentName: reply.agentName,
        reply: reply.body,
        newStatus,
        link: await this.ticketLink(ticket),
      }),
    });
  }

  /**
   * A change made with a reply is in the reply's email, and a customer's
   * own reply reopening their ticket needs no email: only a change on its
   * own, which only staff make, sends one.
   */
  private async statusChanged(job: OutboxJob): Promise<void> {
    const event = payloadOf(ticketStatusChangedSchema, job);
    if (event.messageId !== null) return;
    const ticket = await this.ticketOrSkip(event.ticketId, job);
    if (ticket === undefined) return;
    await this.notifications.notify({
      eventId: job.eventId,
      ticketId: ticket.id,
      recipient: customerRecipient(ticket.customer),
      from: senderOf(ticket.brand),
      template: "statusChanged",
      data: async () => ({
        ...this.facts(ticket),
        status: event.toStatus,
        link: await this.ticketLink(ticket),
      }),
    });
  }

  /** A fresh guest link, asked for from the access page (ADR-0003, section 6). */
  private async guestAccess(job: OutboxJob): Promise<void> {
    const { ticketId } = payloadOf(guestAccessRequestedSchema, job);
    const ticket = await this.ticketOrSkip(ticketId, job);
    if (ticket === undefined) return;
    await this.notifications.notify({
      eventId: job.eventId,
      ticketId,
      recipient: customerRecipient(ticket.customer),
      from: senderOf(ticket.brand),
      template: "guestLink",
      data: async () => ({
        ...this.facts(ticket),
        link: await this.guestLink(ticket),
      }),
    });
  }

  /** A verification link, or a sign-in reminder for an address that has an account. */
  private async signupRequested(job: OutboxJob): Promise<void> {
    const { customerId } = payloadOf(customerSignupRequestedSchema, job);
    const customer = await this.data.customer(customerId);
    if (customer === undefined) return;
    const brand = await this.data.brandSender(this.publicBrandSlug);
    const common = {
      eventId: job.eventId,
      ticketId: null,
      recipient: customerRecipient(customer),
      from: brand.sender,
    };
    if (customer.hasAccount) {
      await this.notifications.notify({
        ...common,
        template: "signupExistingAccount",
        data: () =>
          Promise.resolve({
            brandName: brand.name,
            signInLink: this.links.signIn(),
            resetLink: this.links.forgotPassword(),
          }),
      });
      return;
    }
    await this.notifications.notify({
      ...common,
      template: "signupVerify",
      data: async () => ({
        brandName: brand.name,
        link: this.links.signupComplete(
          await createLinkToken(this.db, {
            purpose: "customer_signup",
            customerId,
          }),
        ),
      }),
    });
  }

  /** A reset link for an account, or a pointer to sign-up for an address without one. */
  private async resetRequested(job: OutboxJob): Promise<void> {
    const { customerId } = payloadOf(customerPasswordResetRequestedSchema, job);
    const customer = await this.data.customer(customerId);
    if (customer === undefined) return;
    const brand = await this.data.brandSender(this.publicBrandSlug);
    const common = {
      eventId: job.eventId,
      ticketId: null,
      recipient: customerRecipient(customer),
      from: brand.sender,
    };
    if (!customer.hasAccount) {
      await this.notifications.notify({
        ...common,
        template: "passwordResetNoAccount",
        data: () =>
          Promise.resolve({
            brandName: brand.name,
            signupLink: this.links.signup(),
          }),
      });
      return;
    }
    await this.notifications.notify({
      ...common,
      template: "passwordReset",
      data: async () => ({
        brandName: brand.name,
        link: this.links.passwordReset(
          await createLinkToken(this.db, {
            purpose: "password_reset",
            customerId,
          }),
        ),
      }),
    });
  }

  /** An invite for an active agent who hasn't set a password yet; anyone else gets nothing. */
  private async agentInvited(job: OutboxJob): Promise<void> {
    const { agentId } = payloadOf(agentInvitedSchema, job);
    const agent = await this.data.agent(agentId);
    if (agent === undefined || !agent.active || agent.hasPassword) {
      this.logger.info(
        { eventId: job.eventId },
        "invite no longer needed; nothing sent",
      );
      return;
    }
    const brand =
      (await this.data.agentBrand(agentId)) ??
      (await this.data.brandSender(this.publicBrandSlug));
    await this.notifications.notify({
      eventId: job.eventId,
      ticketId: null,
      recipient: { kind: "agent", agentId, email: agent.email },
      from: brand.sender,
      template: "agentInvite",
      data: async () => ({
        brandName: brand.name,
        agentName: agent.displayName,
        link: this.links.agentInvite(
          await createLinkToken(this.db, { purpose: "agent_invite", agentId }),
        ),
      }),
    });
  }

  private async ticketOrSkip(
    ticketId: string,
    job: OutboxJob,
  ): Promise<TicketForEmail | undefined> {
    const ticket = await this.data.ticket(ticketId);
    if (ticket === undefined) {
      this.logger.warn(
        { eventId: job.eventId },
        "ticket not found; nothing sent",
      );
    }
    return ticket;
  }

  private facts(ticket: TicketForEmail) {
    return {
      brandName: ticket.brand.name,
      reference: ticket.reference,
      subject: ticket.subject,
    };
  }

  private async ticketLink(ticket: TicketForEmail): Promise<TicketLink> {
    return ticket.customer.hasAccount
      ? { kind: "account", url: this.links.customerTicket(ticket.id) }
      : this.guestLink(ticket);
  }

  private async guestLink(ticket: TicketForEmail): Promise<TicketLink> {
    const token = await createLinkToken(this.db, {
      purpose: "guest_ticket_access",
      customerId: ticket.customer.id,
      ticketId: ticket.id,
    });
    return { kind: "guest", url: this.links.guestAccess(token) };
  }
}
