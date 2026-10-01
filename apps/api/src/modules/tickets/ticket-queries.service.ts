import { Inject, Injectable } from "@nestjs/common";
import {
  type AuditEvent,
  type CustomerTicket,
  type CustomerTicketSummary,
  type PageQuery,
  PROBLEM_TYPES,
  type QueueQuery,
  type StaffCustomer,
  type StaffTicket,
  type StaffTicketSummary,
  ticketPrioritySchema,
} from "@dsd/shared";
import { z } from "zod";

import type {
  CustomerPrincipal,
  StaffPrincipal,
} from "../../auth/principal.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { ObjectStore } from "../../infrastructure/object-store.js";
import { DB } from "../../infrastructure/tokens.js";
import { AttachmentsRepository } from "../attachments/attachments.repository.js";
import type { Download } from "../attachments/download.js";
import { AuditRepository } from "../audit/audit.repository.js";
import {
  decodeCursor,
  encodeCursor,
  exactTimestamp,
  pageFrom,
} from "../../common/cursor.js";
import type { StaffView } from "./domain/ticket-actions.js";
import { MessagesRepository } from "./messages.repository.js";
import {
  type CustomerScope,
  type QueuePosition,
  TicketsRepository,
} from "./tickets.repository.js";
import {
  iso,
  type SummaryRow,
  toCustomerTicket,
  toStaffSummary,
  toStaffTicket,
} from "./views.js";

/** The same answer whether the ticket doesn't exist or isn't the caller's to see (ADR-0004, section 3). */
export const ticketNotFound = () =>
  new ProblemException(404, PROBLEM_TYPES.blank, "No such ticket.");

export const scopeOf = (principal: CustomerPrincipal): CustomerScope => ({
  customerId: principal.customer.id,
  guestTicketId: principal.guestTicketId,
});

export const staffViewOf = (principal: StaffPrincipal): StaffView => ({
  agentId: principal.agent.id,
  permissions: principal.permissions,
});

const attachmentNotFound = () =>
  new ProblemException(404, PROBLEM_TYPES.blank, "No such attachment.");

const CUSTOMER_SORT = "newest";
const HISTORY_SORT = "oldest";
const customerKeys = z.tuple([exactTimestamp]);
const priorityKeys = z.tuple([ticketPrioritySchema, exactTimestamp]);

/** Reads a queue cursor for `sort`; a cursor from another sort order is a 400. */
function queuePosition(
  cursor: string,
  sort: QueueQuery["sort"],
): QueuePosition {
  if (sort === "priority") {
    return { sort, ...decodeCursor(cursor, sort, priorityKeys) };
  }
  return { sort, ...decodeCursor(cursor, sort, customerKeys) };
}

const summaryPage = (
  rows: readonly (SummaryRow & { cursorAt: string })[],
  limit: number,
  cursorOf: (row: SummaryRow & { cursorAt: string }) => string,
): { items: StaffTicketSummary[]; nextCursor: string | null } =>
  pageFrom(rows, limit, toStaffSummary, cursorOf);

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
    private readonly objects: ObjectStore,
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

  /**
   * The staff queue (FR-7): tickets in the agent's brands, whatever channel
   * they came from, filtered and sorted. Without a status filter it shows
   * the tickets that need action: `open`.
   */
  async queue(
    principal: StaffPrincipal,
    query: QueueQuery,
  ): Promise<{ items: StaffTicketSummary[]; nextCursor: string | null }> {
    const { sort } = query;
    const rows = await this.tickets.queuePage(
      this.db,
      principal.agent.id,
      {
        statuses: query.status ?? ["open"],
        priorities: query.priority,
        assigneeId:
          query.assignee === "me"
            ? principal.agent.id
            : query.assignee === "unassigned"
              ? null
              : query.assignee,
        escalated: query.escalated,
      },
      sort,
      {
        limit: query.limit,
        after:
          query.cursor === undefined
            ? undefined
            : queuePosition(query.cursor, sort),
      },
    );
    return summaryPage(rows, query.limit, (row) =>
      encodeCursor(sort, {
        keys:
          sort === "priority" ? [row.priority, row.cursorAt] : [row.cursorAt],
        id: row.id,
      }),
    );
  }

  /**
   * One ticket for staff (FR-8): the whole thread including internal notes,
   * every file, the customer, and what this agent may do to it now.
   */
  async staffTicket(
    principal: StaffPrincipal,
    ticketId: string,
  ): Promise<StaffTicket> {
    return this.db.transaction(async (tx) => {
      const ticket = await this.tickets.staffTicket(
        tx,
        principal.agent.id,
        ticketId,
      );
      if (ticket === undefined) throw ticketNotFound();
      const thread = await this.messages.thread(tx, ticket.id, "all");
      const files = await this.attachments.forTicket(tx, ticket.id, "all");
      return toStaffTicket(staffViewOf(principal), ticket, thread, files);
    }, SNAPSHOT);
  }

  /** A customer and their tickets in the agent's brands (FR-8). */
  async staffCustomer(
    principal: StaffPrincipal,
    customerId: string,
    query: PageQuery,
  ): Promise<StaffCustomer> {
    return this.db.transaction(async (tx) => {
      const customer = await this.tickets.customerForStaff(
        tx,
        principal.agent.id,
        customerId,
      );
      if (customer === undefined) {
        throw new ProblemException(
          404,
          PROBLEM_TYPES.blank,
          "No such customer.",
        );
      }
      const rows = await this.tickets.customerTicketsForStaff(
        tx,
        principal.agent.id,
        customerId,
        {
          limit: query.limit,
          after:
            query.cursor === undefined
              ? undefined
              : decodeCursor(query.cursor, CUSTOMER_SORT, customerKeys),
        },
      );
      return {
        customer: { ...customer, createdAt: iso(customer.createdAt) },
        tickets: summaryPage(rows, query.limit, (row) =>
          encodeCursor(CUSTOMER_SORT, { keys: [row.cursorAt], id: row.id }),
        ),
      };
    }, SNAPSHOT);
  }

  /**
   * A file on one of the customer's tickets (ADR-0009, section 4). Files on
   * internal notes, and files on tickets the session can't see, don't
   * exist as far as a customer is concerned.
   */
  async customerAttachment(
    principal: CustomerPrincipal,
    ticketId: string,
    attachmentId: string,
  ): Promise<Download> {
    const visible = await this.tickets.customerTicket(
      this.db,
      scopeOf(principal),
      ticketId,
    );
    if (visible === undefined) throw attachmentNotFound();
    return this.download(ticketId, attachmentId, "public");
  }

  /** Any file on a ticket in the agent's brands. */
  async staffAttachment(
    principal: StaffPrincipal,
    ticketId: string,
    attachmentId: string,
  ): Promise<Download> {
    if (
      !(await this.tickets.visibleToStaff(
        this.db,
        principal.agent.id,
        ticketId,
      ))
    ) {
      throw attachmentNotFound();
    }
    return this.download(ticketId, attachmentId, "all");
  }

  /** A ticket's history, oldest first, a page at a time (FR-18). */
  async auditTrail(
    principal: StaffPrincipal,
    ticketId: string,
    query: PageQuery,
  ): Promise<{ items: AuditEvent[]; nextCursor: string | null }> {
    if (
      !(await this.tickets.visibleToStaff(
        this.db,
        principal.agent.id,
        ticketId,
      ))
    ) {
      throw ticketNotFound();
    }
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, HISTORY_SORT, customerKeys);
    const rows = await this.audit.ticketHistory(this.db, ticketId, {
      limit: query.limit,
      after:
        after === undefined ? undefined : { at: after.keys[0], id: after.id },
    });
    return pageFrom(
      rows,
      query.limit,
      (row) => ({
        id: row.id,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        actor: { type: row.actorType, id: row.actorId, name: row.actorName },
        before: row.before as Record<string, unknown> | null,
        after: row.after as Record<string, unknown> | null,
        requestId: row.requestId,
        createdAt: iso(row.createdAt),
      }),
      (row) => encodeCursor(HISTORY_SORT, { keys: [row.cursorAt], id: row.id }),
    );
  }

  private async download(
    ticketId: string,
    attachmentId: string,
    visibility: "public" | "all",
  ): Promise<Download> {
    const file = await this.attachments.findForDownload(
      this.db,
      ticketId,
      attachmentId,
      visibility,
    );
    if (file === undefined) throw attachmentNotFound();
    return {
      filename: file.filename,
      contentType: file.contentType,
      sizeBytes: file.sizeBytes,
      stream: await this.objects.get(file.objectKey),
    };
  }
}
