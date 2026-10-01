import { Inject, Injectable } from "@nestjs/common";
import {
  type CustomerTicketFields,
  type CustomerTicketSummary,
  type GuestTicketFields,
  type GuestTicketReceipt,
  normalizeEmail,
  PROBLEM_TYPES,
} from "@dsd/shared";

import { RateLimitEnforcer } from "../../auth/rate-limit/enforcer.js";
import { RATE_LIMITS } from "../../auth/rate-limit/policies.js";
import type { CustomerPrincipal } from "../../auth/principal.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Env } from "../../config/env.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB, ENV } from "../../infrastructure/tokens.js";
import {
  AttachmentIntake,
  type StoredFile,
} from "../attachments/attachment-intake.js";
import { AttachmentsRepository } from "../attachments/attachments.repository.js";
import type { Submission } from "../attachments/multipart.js";
import {
  AuditRepository,
  type ChangeContext,
} from "../audit/audit.repository.js";
import { CustomersRepository } from "../customers/customers.repository.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import { TicketsRepository } from "./tickets.repository.js";

/**
 * Raising a ticket (FR-1, FR-2; ADR-0003, section 6). A guest gives an
 * email and gets a reference back, but no session: only the owner of the
 * inbox can open the thread, through the emailed link. A signed-in
 * customer's account email is the contact, already proven.
 *
 * Each submission is one transaction: the ticket, its attachments, their
 * audit events and the `ticket.created` outbox event. The notification and
 * AI suggestion that follow happen later in the worker, so a slow email
 * provider never delays a submission (NFR-4, NFR-10).
 */
@Injectable()
export class TicketSubmissionService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    @Inject(ENV) private readonly env: Env,
    private readonly tickets: TicketsRepository,
    private readonly customers: CustomersRepository,
    private readonly attachments: AttachmentsRepository,
    private readonly audit: AuditRepository,
    private readonly outbox: OutboxRepository,
    private readonly intake: AttachmentIntake,
    private readonly limits: RateLimitEnforcer,
  ) {}

  async submitAsGuest(
    { fields, files }: Submission<GuestTicketFields>,
    requestId: string,
  ): Promise<GuestTicketReceipt> {
    const emailNormalized = normalizeEmail(fields.email);
    await this.limits.enforce(RATE_LIMITS.ticketSubmission, {
      email: emailNormalized,
    });
    return this.intake.storeThen(files, (stored) =>
      this.db.transaction(async (tx) => {
        const customerId = await this.customers.findOrCreate(
          tx,
          fields.email,
          emailNormalized,
        );
        const ticket = await this.file(tx, {
          customerId,
          fields,
          stored,
          contactVerified: false,
          requestId,
        });
        return { reference: ticket.reference };
      }),
    );
  }

  /**
   * A guest session can see one ticket and nothing else, so it can't add
   * tickets to the account behind it; a guest uses the public form.
   */
  async submitAsCustomer(
    principal: CustomerPrincipal,
    { fields, files }: Submission<CustomerTicketFields>,
    requestId: string,
  ): Promise<CustomerTicketSummary> {
    if (principal.guestTicketId !== null) {
      throw new ProblemException(
        403,
        PROBLEM_TYPES.blank,
        "A guest link opens one ticket. Use the support form to raise another.",
      );
    }
    await this.limits.enforce(RATE_LIMITS.ticketSubmission, {
      email: normalizeEmail(principal.customer.email),
    });
    return this.intake.storeThen(files, (stored) =>
      this.db.transaction(async (tx) => {
        const ticket = await this.file(tx, {
          customerId: principal.customer.id,
          fields,
          stored,
          contactVerified: true,
          requestId,
        });
        return {
          id: ticket.id,
          reference: ticket.reference,
          subject: ticket.subject,
          status: ticket.status,
          createdAt: ticket.createdAt.toISOString(),
        };
      }),
    );
  }

  private async file(
    tx: Executor,
    submission: {
      customerId: string;
      fields: CustomerTicketFields;
      stored: readonly StoredFile[];
      contactVerified: boolean;
      requestId: string;
    },
  ) {
    const { customerId, fields, stored } = submission;
    const ticket = await this.tickets.insert(tx, {
      brandId: await this.tickets.brandIdBySlug(tx, this.env.TICKET_BRAND_SLUG),
      customerId,
      channel: "web",
      subject: fields.subject,
      description: fields.description,
      contactVerified: submission.contactVerified,
    });
    const actor = { type: "customer", customerId } as const;
    const files = await this.attachments.insert(
      tx,
      { ticketId: ticket.id, messageId: null },
      actor,
      stored,
    );
    const context: ChangeContext = { actor, requestId: submission.requestId };
    await this.audit.record(tx, context, [
      {
        ticketId: ticket.id,
        entityType: "ticket",
        entityId: ticket.id,
        action: "ticket.created",
        before: null,
        after: {
          status: ticket.status,
          priority: ticket.priority,
          channel: ticket.channel,
        },
      },
      ...files.map((file) => ({
        ticketId: ticket.id,
        entityType: "attachment" as const,
        entityId: file.id,
        action: "attachment.created" as const,
        before: null,
        after: {
          messageId: null,
          contentType: file.contentType,
          sizeBytes: file.sizeBytes,
        },
      })),
    ]);
    await this.outbox.add(tx, {
      type: "ticket.created",
      aggregateType: "ticket",
      aggregateId: ticket.id,
      payload: { ticketId: ticket.id, customerId },
    });
    return ticket;
  }
}
