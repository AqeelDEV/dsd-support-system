import { Inject, Injectable } from "@nestjs/common";
import {
  type Agent,
  type AgentInviteRequest,
  type AgentListQuery,
  type AgentRoleChangeRequest,
  type AgentUpdateRequest,
  normalizeEmail,
  PROBLEM_TYPES,
} from "@dsd/shared";
import { z } from "zod";

import { SessionService } from "../../auth/sessions/session.service.js";
import type { StaffPrincipal } from "../../auth/principal.js";
import { decodeCursor, encodeCursor, pageFrom } from "../../common/cursor.js";
import { ProblemException } from "../../common/problem-details.js";
import type { Executor } from "../../infrastructure/database.js";
import { DB } from "../../infrastructure/tokens.js";
import {
  AuditRepository,
  type ChangeContext,
} from "../audit/audit.repository.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import { staffContext, TicketChanges } from "../tickets/ticket-changes.js";
import { TicketsRepository } from "../tickets/tickets.repository.js";
import { type AgentRow, AgentsRepository } from "./agents.repository.js";
import {
  allowedAgentActions,
  assertCanEdit,
  assertCanInvite,
  assertCanResendInvite,
  canManage,
  type Colleague,
  decideDeactivation,
  decideReactivation,
  decideRoleChange,
  grantableRoles,
  type Manager,
} from "./domain/rank-rules.js";

const BY_NAME = "name";

const agentNotFound = () =>
  new ProblemException(
    404,
    PROBLEM_TYPES.blank,
    "No such agent in your brands.",
  );

const asColleague = (row: AgentRow): Colleague => ({
  id: row.id,
  role: row.role,
  active: row.deactivatedAt === null,
  hasPassword: row.hasPassword,
});

const asManager = (row: AgentRow): Manager => ({
  id: row.id,
  role: row.role,
  active: row.deactivatedAt === null,
});

/** The viewer as the session resolved them on this request. */
const viewerOf = (principal: StaffPrincipal): Manager => ({
  id: principal.agent.id,
  role: principal.agent.role,
  active: true,
});

/**
 * Agent accounts and roles (FR-14; ADR-0004, section 4). Every change runs
 * in one transaction that first takes the management lock, then locks the
 * rows it reads, and checks the rank rules against them, so a manager who
 * was demoted a moment ago acts with their new role. Role changes and
 * deactivation sign the colleague out everywhere at once; deactivation
 * also hands their open tickets back to the queue.
 */
@Injectable()
export class AgentsService {
  constructor(
    @Inject(DB) private readonly db: Executor,
    private readonly agents: AgentsRepository,
    private readonly sessions: SessionService,
    private readonly tickets: TicketsRepository,
    private readonly changes: TicketChanges,
    private readonly audit: AuditRepository,
    private readonly outbox: OutboxRepository,
  ) {}

  async list(principal: StaffPrincipal, query: AgentListQuery) {
    const after =
      query.cursor === undefined
        ? undefined
        : decodeCursor(query.cursor, BY_NAME, z.tuple([z.string()]));
    const rows = await this.agents.page(
      this.db,
      principal.agent.id,
      { status: query.status, role: query.role },
      { limit: query.limit, after },
    );
    const toView = await this.views(principal, rows.slice(0, query.limit));
    return pageFrom(rows, query.limit, toView, (row) =>
      encodeCursor(BY_NAME, { keys: [row.displayName], id: row.id }),
    );
  }

  async get(principal: StaffPrincipal, agentId: string): Promise<Agent> {
    const row = await this.agents.visible(this.db, principal.agent.id, agentId);
    if (row === undefined) throw agentNotFound();
    const toView = await this.views(principal, [row]);
    return toView(row);
  }

  /**
   * Creates the agent without a password, in the inviter's brands, and
   * asks the worker to email the invite (ADR-0003, section 8).
   */
  async invite(
    principal: StaffPrincipal,
    request: AgentInviteRequest,
    requestId: string,
  ): Promise<Agent> {
    const agentId = await this.db.transaction(async (tx) => {
      await this.agents.serialiseManagement(tx);
      const manager = await this.agents.lockOne(tx, principal.agent.id);
      if (manager === undefined) throw agentNotFound();
      assertCanInvite(asManager(manager), request.role);
      const id = await this.agents.insert(tx, {
        email: request.email,
        emailNormalized: normalizeEmail(request.email),
        displayName: request.displayName,
        role: request.role,
        invitedByAgentId: manager.id,
      });
      if (id === undefined) {
        throw new ProblemException(
          409,
          PROBLEM_TYPES.alreadyExists,
          "There is already a staff account with that email.",
        );
      }
      await this.agents.copyMemberships(tx, id, manager.id);
      const context = staffContext(principal, requestId);
      await this.record(tx, context, id, "agent.invited", null, {
        role: request.role,
      });
      await this.inviteEmail(tx, id);
      return id;
    });
    return this.get(principal, agentId);
  }

  async update(
    principal: StaffPrincipal,
    agentId: string,
    request: AgentUpdateRequest,
  ): Promise<Agent> {
    await this.underLock(principal, agentId, async (tx, manager, colleague) => {
      assertCanEdit(manager, colleague);
      await this.agents.setDisplayName(tx, colleague.id, request.displayName);
    });
    return this.get(principal, agentId);
  }

  /** A new role applies on the colleague's next request: their sessions are revoked. */
  async changeRole(
    principal: StaffPrincipal,
    agentId: string,
    request: AgentRoleChangeRequest,
    requestId: string,
  ): Promise<Agent> {
    await this.underLock(principal, agentId, async (tx, manager, colleague) => {
      const decision = decideRoleChange(
        manager,
        colleague,
        request.role,
        await this.agents.otherActiveAdmins(tx, colleague.id),
      );
      if (decision === "unchanged") return;
      await this.agents.setRole(tx, colleague.id, decision);
      await this.sessions.revokeAllFor(tx, { agentId: colleague.id });
      await this.record(
        tx,
        staffContext(principal, requestId),
        colleague.id,
        "agent.role_changed",
        { role: colleague.role },
        { role: decision },
      );
    });
    return this.get(principal, agentId);
  }

  /**
   * Deactivates the colleague: they are signed out everywhere, and their
   * `open` and `pending_customer` tickets go back to the queue, each with
   * its own history (ADR-0007, section 5).
   *
   * The colleague's row is locked before their tickets are read. An
   * assignment to them holds a share lock on that row until it commits,
   * so locking it first waits for any assignment in flight, and the ticket
   * query then sees it and unassigns that ticket too. From then on, a new
   * assignment finds them deactivated (422).
   */
  async deactivate(
    principal: StaffPrincipal,
    agentId: string,
    requestId: string,
  ): Promise<Agent> {
    await this.db.transaction(async (tx) => {
      await this.agents.serialiseManagement(tx);
      const { manager, colleague } = await this.lockPair(
        tx,
        principal,
        agentId,
      );
      const decision = decideDeactivation(
        manager,
        colleague,
        await this.agents.otherActiveAdmins(tx, colleague.id),
      );
      if (decision === "unchanged") return;
      const context = staffContext(principal, requestId);
      await this.agents.setActive(tx, colleague.id, false);
      await this.sessions.revokeAllFor(tx, { agentId: colleague.id });
      const openTickets = await this.tickets.lockOpenAssignedTo(
        tx,
        colleague.id,
      );
      for (const ticket of openTickets) {
        await this.changes.assign(tx, context, ticket, null);
      }
      await this.record(
        tx,
        context,
        colleague.id,
        "agent.deactivated",
        { active: true },
        { active: false },
      );
    });
    return this.get(principal, agentId);
  }

  async reactivate(
    principal: StaffPrincipal,
    agentId: string,
    requestId: string,
  ): Promise<Agent> {
    await this.underLock(principal, agentId, async (tx, manager, colleague) => {
      if (decideReactivation(manager, colleague) === "unchanged") return;
      await this.agents.setActive(tx, colleague.id, true);
      await this.record(
        tx,
        staffContext(principal, requestId),
        colleague.id,
        "agent.reactivated",
        { active: false },
        { active: true },
      );
    });
    return this.get(principal, agentId);
  }

  /** Invite links last 72 hours; this asks the worker for a fresh one. */
  async resendInvite(
    principal: StaffPrincipal,
    agentId: string,
  ): Promise<Agent> {
    await this.underLock(principal, agentId, async (tx, manager, colleague) => {
      assertCanResendInvite(manager, colleague);
      await this.inviteEmail(tx, colleague.id);
    });
    return this.get(principal, agentId);
  }

  /** Runs `change` with the management lock held and both rows locked. */
  private async underLock(
    principal: StaffPrincipal,
    agentId: string,
    change: (
      tx: Executor,
      manager: Manager,
      colleague: Colleague,
    ) => Promise<void>,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.agents.serialiseManagement(tx);
      const { manager, colleague } = await this.lockPair(
        tx,
        principal,
        agentId,
      );
      await change(tx, manager, colleague);
    });
  }

  private async lockPair(
    tx: Executor,
    principal: StaffPrincipal,
    agentId: string,
  ): Promise<{ manager: Manager; colleague: Colleague }> {
    const rows = await this.agents.lockPair(tx, principal.agent.id, agentId);
    if (rows.colleague === undefined || rows.manager === undefined) {
      throw agentNotFound();
    }
    return {
      manager: asManager(rows.manager),
      colleague: asColleague(rows.colleague),
    };
  }

  private async inviteEmail(tx: Executor, agentId: string): Promise<void> {
    await this.outbox.add(tx, {
      type: "agent.invited",
      aggregateType: "agent",
      aggregateId: agentId,
      payload: { agentId },
    });
  }

  /** History that isn't about a ticket: `ticket_id` stays empty (ADR-0008, section 3). */
  private record(
    tx: Executor,
    context: ChangeContext,
    agentId: string,
    action:
      | "agent.invited"
      | "agent.role_changed"
      | "agent.deactivated"
      | "agent.reactivated",
    before: Record<string, unknown> | null,
    after: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record(tx, context, [
      {
        ticketId: null,
        entityType: "agent",
        entityId: agentId,
        action,
        before,
        after,
      },
    ]);
  }

  /** Builds responses for `rows`, with what the viewer may do to each. */
  private async views(
    principal: StaffPrincipal,
    rows: readonly AgentRow[],
  ): Promise<(row: AgentRow) => Agent> {
    const memberships = await this.agents.brandsOf(
      this.db,
      rows.map((row) => row.id),
    );
    const viewer = viewerOf(principal);
    return (row) => {
      const colleague = asColleague(row);
      const status = !colleague.active
        ? "deactivated"
        : row.hasPassword
          ? "active"
          : "invited";
      return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        role: row.role,
        status,
        brands: memberships
          .filter((brand) => brand.agentId === row.id)
          .map(({ id, slug, name }) => ({ id, slug, name })),
        lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
        deactivatedAt: row.deactivatedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        allowedActions: allowedAgentActions(viewer, colleague),
        grantableRoles: canManage(viewer, colleague)
          ? grantableRoles(viewer)
          : [],
      };
    };
  }
}
