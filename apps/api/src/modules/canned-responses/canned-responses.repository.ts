import { Injectable } from "@nestjs/common";
import {
  agentBrandMemberships,
  agents,
  cannedResponses,
  customers,
  tickets,
} from "@dsd/db/schema";
import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNull,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias, type AnyPgColumn } from "drizzle-orm/pg-core";

import type { Position } from "../../common/cursor.js";
import type { Executor } from "../../infrastructure/database.js";

/** The partial unique index on active titles: a clash is a 409. */
export const ACTIVE_TITLE_KEY = "canned_responses_active_title_key";

function inBrandsOf(agentId: string, column: AnyPgColumn): SQL {
  return inArray(
    column,
    sql`(SELECT ${agentBrandMemberships.brandId} FROM ${agentBrandMemberships} WHERE ${agentBrandMemberships.agentId} = ${agentId})`,
  );
}

/** `%` and `_` in a search are text, not wildcards. */
const escapeLike = (text: string) => text.replace(/[\\%_]/g, "\\$&");

const createdBy = alias(agents, "created_by");
const updatedBy = alias(agents, "updated_by");

const columns = {
  id: cannedResponses.id,
  brandId: cannedResponses.brandId,
  title: cannedResponses.title,
  body: cannedResponses.body,
  retiredAt: cannedResponses.retiredAt,
  createdBy: { id: createdBy.id, displayName: createdBy.displayName },
  updatedBy: { id: updatedBy.id, displayName: updatedBy.displayName },
  createdAt: cannedResponses.createdAt,
  updatedAt: cannedResponses.updatedAt,
};

/** Canned responses in the agent's brands (ADR-0004, section 6). */
@Injectable()
export class CannedResponsesRepository {
  /** By title, with one extra row to show whether another page follows. */
  async page(
    executor: Executor,
    agentId: string,
    filters: { q: string | undefined; includeRetired: boolean },
    page: { limit: number; after: Position<[string]> | undefined },
  ) {
    const after = page.after;
    return executor
      .select(columns)
      .from(cannedResponses)
      .innerJoin(createdBy, eq(createdBy.id, cannedResponses.createdByAgentId))
      .innerJoin(updatedBy, eq(updatedBy.id, cannedResponses.updatedByAgentId))
      .where(
        and(
          inBrandsOf(agentId, cannedResponses.brandId),
          filters.includeRetired
            ? undefined
            : isNull(cannedResponses.retiredAt),
          filters.q === undefined
            ? undefined
            : ilike(cannedResponses.title, `%${escapeLike(filters.q)}%`),
          after === undefined
            ? undefined
            : sql`(${cannedResponses.title}, ${cannedResponses.id}) > (${after.keys[0]}, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(cannedResponses.title), asc(cannedResponses.id))
      .limit(page.limit + 1);
  }

  async one(executor: Executor, agentId: string, id: string) {
    const [row] = await executor
      .select(columns)
      .from(cannedResponses)
      .innerJoin(createdBy, eq(createdBy.id, cannedResponses.createdByAgentId))
      .innerJoin(updatedBy, eq(updatedBy.id, cannedResponses.updatedByAgentId))
      .where(
        and(
          eq(cannedResponses.id, id),
          inBrandsOf(agentId, cannedResponses.brandId),
        ),
      );
    return row;
  }

  async insert(
    executor: Executor,
    template: { brandId: string; title: string; body: string; agentId: string },
  ): Promise<string> {
    const [row] = await executor
      .insert(cannedResponses)
      .values({
        brandId: template.brandId,
        title: template.title,
        body: template.body,
        createdByAgentId: template.agentId,
        updatedByAgentId: template.agentId,
      })
      .returning({ id: cannedResponses.id });
    if (row === undefined)
      throw new Error("canned response insert returned nothing");
    return row.id;
  }

  async update(
    executor: Executor,
    id: string,
    agentId: string,
    fields: { title?: string; body?: string },
  ): Promise<void> {
    await executor
      .update(cannedResponses)
      .set({ ...fields, updatedByAgentId: agentId })
      .where(eq(cannedResponses.id, id));
  }

  /** Hides it from the composer; it is kept, never deleted. Retiring twice changes nothing. */
  async retire(executor: Executor, id: string, agentId: string): Promise<void> {
    await executor
      .update(cannedResponses)
      .set({ retiredAt: sql`now()`, updatedByAgentId: agentId })
      .where(
        and(eq(cannedResponses.id, id), isNull(cannedResponses.retiredAt)),
      );
  }

  /** What the variables are filled from, if the ticket is in the agent's brands. */
  async ticketForRendering(
    executor: Executor,
    agentId: string,
    ticketId: string,
  ) {
    const [row] = await executor
      .select({
        brandId: tickets.brandId,
        reference: tickets.reference,
        subject: tickets.subject,
        customerName: customers.displayName,
        customerEmail: customers.email,
      })
      .from(tickets)
      .innerJoin(customers, eq(customers.id, tickets.customerId))
      .where(
        and(eq(tickets.id, ticketId), inBrandsOf(agentId, tickets.brandId)),
      );
    return row;
  }
}
