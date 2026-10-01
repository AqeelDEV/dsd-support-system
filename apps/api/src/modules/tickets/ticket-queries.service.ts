import { Inject, Injectable } from "@nestjs/common";
import {
  type CustomerTicket,
  type CustomerTicketSummary,
  type PageQuery,
  PROBLEM_TYPES,
} from "@dsd/shared";
import { z } from "zod";

import type { CustomerPrincipal } from "../../auth/principal.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import { AttachmentsRepository } from "../attachments/attachments.repository.js";
import { AuditRepository } from "../audit/audit.repository.js";
import {
  decodeCursor,
  encodeCursor,
  exactTimestamp,
  pageFrom,
} from "./domain/cursor.js";
import { MessagesRepository } from "./messages.repository.js";
import { type CustomerScope, TicketsRepository } from "./tickets.repository.js";
import { iso, toCustomerTicket } from "./views.js";

/** The same answer whether the ticket doesn't exist or isn't the caller's to see (ADR-0004, section 3). */
export const ticketNotFound = () =>
  new ProblemException(404, PROBLEM_TYPES.blank, "No such ticket.");

export const scopeOf = (principal: CustomerPrincipal): CustomerScope => ({
  customerId: principal.customer.id,
  guestTicketId: principal.guestTicketId,
});

const CUSTOMER_SORT = "newest";
const customerKeys = z.tuple([exactTimestamp]);

/** One consistent snapshot for a view assembled from several queries. */
const SNAPSHOT = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
} as const;

/** Reading tickets: the customer's own (FR-3) and the staff queue and views (FR-7, FR-8). */
@Injectable()
export class TicketQueriesService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly tickets: TicketsRepository,
    private readonly messages: MessagesRepository,
    private readonly attachments: AttachmentsRepository,
    private readonly audit: AuditRepository,
  ) {}

  /** The customer's tickets, newest first; a guest session sees its one ticket. */
  async customerTickets(
    principal: CustomerPrincipal,
    query: PageQuery,
  ): Promise<{ items: CustomerTicketSummary[]; nextCursor: string | null }> {
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, CUSTOMER_SORT, customerKeys);
    const rows = await this.tickets.customerPage(this.db, scopeOf(principal), {
      limit: query.limit,
      after,
    });
    return pageFrom(
      rows,
      query.limit,
      (row) => ({
        id: row.id,
        reference: row.reference,
        subject: row.subject,
        status: row.status,
        createdAt: iso(row.createdAt),
      }),
      (row) =>
        encodeCursor(CUSTOMER_SORT, { keys: [row.cursorAt], id: row.id }),
    );
  }

  /**
   * One ticket as its customer sees it: the status, the description, the
   * public replies with their files, and the status timeline. Internal
   * notes and their files are left out by the queries themselves.
   */
  async customerTicket(
    principal: CustomerPrincipal,
    ticketId: string,
  ): Promise<CustomerTicket> {
    return this.db.transaction(async (tx) => {
      const ticket = await this.tickets.customerTicket(
        tx,
        scopeOf(principal),
        ticketId,
      );
      if (ticket === undefined) throw ticketNotFound();
      const thread = await this.messages.thread(tx, ticket.id, "public");
      const files = await this.attachments.forTicket(tx, ticket.id, "public");
      const changes = await this.audit.statusChanges(tx, ticket.id);
      return toCustomerTicket(ticket, thread, files, changes);
    }, SNAPSHOT);
  }
}
