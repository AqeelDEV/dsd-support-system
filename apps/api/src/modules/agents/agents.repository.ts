import { Injectable } from "@nestjs/common";
import { agentBrandMemberships, agents, brands } from "@dsd/db/schema";
import type { AgentRole, AgentStatus } from "@dsd/shared";
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";

import type { Position } from "../../common/cursor.js";
import type { Executor } from "../../infrastructure/database.js";

/**
 * Brand scope for agent management (ADR-0004, section 6): a colleague is
 * visible when they share at least one brand with the viewer.
 */
function sharesBrandWith(viewerId: string): SQL {
  return sql`EXISTS (
    SELECT 1 FROM ${agentBrandMemberships} AS m
     WHERE m.agent_id = ${agents.id}
       AND m.brand_id IN (SELECT v.brand_id FROM ${agentBrandMemberships} AS v WHERE v.agent_id = ${viewerId})
  )`;
}

function hasStatus(status: AgentStatus): SQL | undefined {
  switch (status) {
    case "active":
      return and(isNull(agents.deactivatedAt), isNotNull(agents.passwordHash));
    case "invited":
      return and(isNull(agents.deactivatedAt), isNull(agents.passwordHash));
    case "deactivated":
      return isNotNull(agents.deactivatedAt);
  }
}

const agentColumns = {
  id: agents.id,
  email: agents.email,
  displayName: agents.displayName,
  role: agents.role,
  hasPassword: sql<boolean>`${agents.passwordHash} IS NOT NULL`,
  deactivatedAt: agents.deactivatedAt,
  lastLoginAt: agents.lastLoginAt,
  createdAt: agents.createdAt,
};

export interface AgentRow {
  id: string;
  email: string;
  displayName: string;
  role: AgentRole;
  hasPassword: boolean;
  deactivatedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface NewAgent {
  email: string;
  emailNormalized: string;
  displayName: string;
  role: AgentRole;
  invitedByAgentId: string;
}

/**
 * The `agents` table as agent management sees it. Reads are limited to
 * colleagues who share a brand with the viewer; writes happen under the
 * locks `AgentsService` takes.
 */
@Injectable()
export class AgentsRepository {
  /**
   * Agent-management changes run one at a time: each takes this
   * transaction-scoped lock before anything else. They are rare, and
   * serialising them makes "never leave the system without an active
   * admin" a plain count, with no lock-ordering puzzle between two admins
   * demoting each other at the same moment.
   */
  async serialiseManagement(executor: Executor): Promise<void> {
    await executor.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('dsd:agent-management'))`,
    );
  }

  /** One page of colleagues by name, with one extra row to show whether another page follows. */
  async page(
    executor: Executor,
    viewerId: string,
    filters: { status: AgentStatus | undefined; role: AgentRole | undefined },
    page: { limit: number; after: Position<[string]> | undefined },
  ): Promise<AgentRow[]> {
    const after = page.after;
    return executor
      .select(agentColumns)
      .from(agents)
      .where(
        and(
          sharesBrandWith(viewerId),
          filters.status === undefined ? undefined : hasStatus(filters.status),
          filters.role === undefined
            ? undefined
            : eq(agents.role, filters.role),
          after === undefined
            ? undefined
            : sql`(${agents.displayName}, ${agents.id}) > (${after.keys[0]}, ${after.id}::uuid)`,
        ),
      )
      .orderBy(asc(agents.displayName), asc(agents.id))
      .limit(page.limit + 1);
  }

  /**
   * Active colleagues who share a brand with the viewer, the viewer
   * included, by name: who a ticket can be handed to (FR-11).
   */
  async assignable(
    executor: Executor,
    viewerId: string,
  ): Promise<{ id: string; displayName: string; role: AgentRole }[]> {
    return executor
      .select({
        id: agents.id,
        displayName: agents.displayName,
        role: agents.role,
      })
      .from(agents)
      .where(and(hasStatus("active"), sharesBrandWith(viewerId)))
      .orderBy(asc(agents.displayName), asc(agents.id));
  }

  /** The colleague, if they share a brand with the viewer. */
  async visible(
    executor: Executor,
    viewerId: string,
    agentId: string,
  ): Promise<AgentRow | undefined> {
    const [row] = await executor
      .select(agentColumns)
      .from(agents)
      .where(and(eq(agents.id, agentId), sharesBrandWith(viewerId)));
    return row;
  }

  /**
   * Locks the manager's row and, if the manager can see them, the
   * colleague's, in ID order. The manager's row is read fresh, so a
   * manager demoted a moment ago acts with their new role.
   */
  async lockPair(
    executor: Executor,
    managerId: string,
    colleagueId: string,
  ): Promise<{
    manager: AgentRow | undefined;
    colleague: AgentRow | undefined;
  }> {
    const lockManager = async () => {
      const [row] = await executor
        .select(agentColumns)
        .from(agents)
        .where(eq(agents.id, managerId))
        .for("update");
      return row;
    };
    const lockColleague = async () => {
      const [row] = await executor
        .select(agentColumns)
        .from(agents)
        .where(and(eq(agents.id, colleagueId), sharesBrandWith(managerId)))
        .for("update", { of: agents });
      return row;
    };
    if (managerId < colleagueId) {
      const manager = await lockManager();
      return { manager, colleague: await lockColleague() };
    }
    const colleague = await lockColleague();
    return { manager: await lockManager(), colleague };
  }

  /** The manager's own row, locked; used when there is no colleague yet (an invite). */
  async lockOne(
    executor: Executor,
    agentId: string,
  ): Promise<AgentRow | undefined> {
    const [row] = await executor
      .select(agentColumns)
      .from(agents)
      .where(eq(agents.id, agentId))
      .for("update");
    return row;
  }

  /** Active admins other than `agentId`. Callers hold the management lock. */
  async otherActiveAdmins(
    executor: Executor,
    agentId: string,
  ): Promise<number> {
    const [row] = await executor
      .select({ count: sql<number>`count(*)::int` })
      .from(agents)
      .where(
        and(
          eq(agents.role, "admin"),
          isNull(agents.deactivatedAt),
          ne(agents.id, agentId),
        ),
      );
    return row?.count ?? 0;
  }

  /** The new agent's ID, or undefined if the email is already taken. */
  async insert(
    executor: Executor,
    agent: NewAgent,
  ): Promise<string | undefined> {
    const [row] = await executor
      .insert(agents)
      .values(agent)
      .onConflictDoNothing({ target: agents.emailNormalized })
      .returning({ id: agents.id });
    return row?.id;
  }

  /** Gives `agentId` the same brands as `fromAgentId`. */
  async copyMemberships(
    executor: Executor,
    agentId: string,
    fromAgentId: string,
  ): Promise<void> {
    await executor.execute(sql`
      INSERT INTO ${agentBrandMemberships} (agent_id, brand_id)
      SELECT ${agentId}, brand_id FROM ${agentBrandMemberships} WHERE agent_id = ${fromAgentId}`);
  }

  /** Brand memberships for a set of agents, for their responses. */
  async brandsOf(
    executor: Executor,
    agentIds: readonly string[],
  ): Promise<{ agentId: string; id: string; slug: string; name: string }[]> {
    if (agentIds.length === 0) return [];
    return executor
      .select({
        agentId: agentBrandMemberships.agentId,
        id: brands.id,
        slug: brands.slug,
        name: brands.name,
      })
      .from(agentBrandMemberships)
      .innerJoin(brands, eq(brands.id, agentBrandMemberships.brandId))
      .where(inArray(agentBrandMemberships.agentId, [...agentIds]))
      .orderBy(asc(brands.name));
  }

  async setDisplayName(
    executor: Executor,
    agentId: string,
    displayName: string,
  ): Promise<void> {
    await executor
      .update(agents)
      .set({ displayName })
      .where(eq(agents.id, agentId));
  }

  async setRole(
    executor: Executor,
    agentId: string,
    role: AgentRole,
  ): Promise<void> {
    await executor.update(agents).set({ role }).where(eq(agents.id, agentId));
  }

  async setActive(
    executor: Executor,
    agentId: string,
    active: boolean,
  ): Promise<void> {
    await executor
      .update(agents)
      .set({ deactivatedAt: active ? null : sql`now()` })
      .where(eq(agents.id, agentId));
  }
}
