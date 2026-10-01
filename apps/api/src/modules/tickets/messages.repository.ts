import { Injectable } from "@nestjs/common";
import { agents, customers, messages } from "@dsd/db/schema";
import type { MessageVisibility, ParticipantType } from "@dsd/shared";
import { and, asc, eq } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";

export interface ThreadMessage {
  id: string;
  visibility: MessageVisibility;
  authorType: ParticipantType;
  authorId: string;
  authorName: string | null;
  body: string;
  createdAt: Date;
}

/**
 * The conversation on a ticket, after its description. Messages are
 * append-only (ADR-0008): this repository inserts and reads, and the
 * database refuses anything else.
 */
@Injectable()
export class MessagesRepository {
  /**
   * The thread, oldest first. With `public`, internal notes are filtered
   * out in the query itself (FR-10), so a customer response can't hold one.
   */
  async thread(
    executor: Executor,
    ticketId: string,
    visibility: "public" | "all",
  ): Promise<ThreadMessage[]> {
    const rows = await executor
      .select({
        id: messages.id,
        visibility: messages.visibility,
        authorType: messages.authorType,
        authorCustomerId: messages.authorCustomerId,
        authorAgentId: messages.authorAgentId,
        agentName: agents.displayName,
        customerName: customers.displayName,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .leftJoin(agents, eq(agents.id, messages.authorAgentId))
      .leftJoin(customers, eq(customers.id, messages.authorCustomerId))
      .where(
        and(
          eq(messages.ticketId, ticketId),
          visibility === "public"
            ? eq(messages.visibility, "public")
            : undefined,
        ),
      )
      .orderBy(asc(messages.createdAt), asc(messages.id));
    return rows.map((row) => ({
      id: row.id,
      visibility: row.visibility,
      authorType: row.authorType,
      // The messages_author_ck constraint guarantees the matching ID is set.
      authorId: row.authorAgentId ?? row.authorCustomerId ?? "",
      authorName: row.authorType === "agent" ? row.agentName : row.customerName,
      body: row.body,
      createdAt: row.createdAt,
    }));
  }
}
