import { createDb, type Pool } from "../client.js";
import {
  agentBrandMemberships,
  agents,
  auditEvents,
  brands,
  cannedResponses,
  customers,
  messages,
  tickets,
} from "../schema/index.js";
import type { Actor, AgentRef, Json, SeedPlan } from "./generate.js";

/** Replaces `{ $agent: key }` references with the written agents' IDs. */
function resolve(value: Json, agentIds: Map<string, string>): unknown {
  if (Array.isArray(value)) return value.map((item) => resolve(item, agentIds));
  if (value !== null && typeof value === "object") {
    if ("$agent" in value && typeof (value as AgentRef).$agent === "string") {
      return idOf(agentIds, (value as AgentRef).$agent);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolve(item as Json, agentIds),
      ]),
    );
  }
  return value;
}

function idOf(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (id === undefined)
    throw new Error(`Seed plan refers to unknown key ${key}`);
  return id;
}

function actorColumns(
  actor: Actor,
  customerIds: Map<string, string>,
  agentIds: Map<string, string>,
) {
  return {
    actorType: actor.type,
    actorCustomerId:
      actor.type === "customer" ? idOf(customerIds, actor.key) : null,
    actorAgentId: actor.type === "agent" ? idOf(agentIds, actor.key) : null,
  };
}

/**
 * Writes the plan in one transaction, so a failed seed leaves nothing
 * behind. Runs as `dsd_migrator`. It writes no outbox events: the demo data
 * must never make the worker email anyone.
 */
export async function writeSeedPlan(
  pool: Pool,
  plan: SeedPlan,
  passwordHash: string,
): Promise<void> {
  await createDb(pool).transaction(async (tx) => {
    const [brand] = await tx
      .insert(brands)
      .values(plan.brand)
      .returning({ id: brands.id });
    if (brand === undefined) throw new Error("brand insert returned nothing");

    const agentIds = new Map<string, string>();
    for (const agent of plan.agents) {
      const [row] = await tx
        .insert(agents)
        .values({
          email: agent.email,
          emailNormalized: agent.email.toLowerCase(),
          displayName: agent.displayName,
          role: agent.role,
          passwordHash: agent.hasPassword ? passwordHash : null,
          invitedByAgentId:
            agent.invitedByKey === null
              ? null
              : idOf(agentIds, agent.invitedByKey),
          deactivatedAt: agent.deactivatedAt,
          createdAt: agent.createdAt,
          updatedAt: agent.deactivatedAt ?? agent.createdAt,
        })
        .returning({ id: agents.id });
      if (row === undefined) throw new Error("agent insert returned nothing");
      agentIds.set(agent.key, row.id);
    }
    await tx.insert(agentBrandMemberships).values(
      plan.agents.map((agent) => ({
        agentId: idOf(agentIds, agent.key),
        brandId: brand.id,
        createdAt: agent.createdAt,
      })),
    );

    const customerIds = new Map<string, string>();
    for (const customer of plan.customers) {
      const [row] = await tx
        .insert(customers)
        .values({
          email: customer.email,
          emailNormalized: customer.email.toLowerCase(),
          displayName: customer.displayName,
          passwordHash: customer.registered ? passwordHash : null,
          emailVerifiedAt: customer.registered ? customer.createdAt : null,
          createdAt: customer.createdAt,
          updatedAt: customer.createdAt,
        })
        .returning({ id: customers.id });
      if (row === undefined)
        throw new Error("customer insert returned nothing");
      customerIds.set(customer.key, row.id);
    }

    for (const ticket of plan.tickets) {
      const [row] = await tx
        .insert(tickets)
        .values({
          brandId: brand.id,
          customerId: idOf(customerIds, ticket.customerKey),
          channel: "web",
          subject: ticket.subject,
          description: ticket.description,
          status: ticket.status,
          priority: ticket.priority,
          assigneeAgentId:
            ticket.assigneeKey === null
              ? null
              : idOf(agentIds, ticket.assigneeKey),
          contactVerifiedAt: ticket.contactVerifiedAt,
          escalatedAt: ticket.escalatedAt,
          escalatedByAgentId:
            ticket.escalatedByKey === null
              ? null
              : idOf(agentIds, ticket.escalatedByKey),
          firstResponseAt: ticket.firstResponseAt,
          resolvedAt: ticket.resolvedAt,
          closedAt: ticket.closedAt,
          createdAt: ticket.createdAt,
          updatedAt: ticket.updatedAt,
        })
        .returning({ id: tickets.id });
      if (row === undefined) throw new Error("ticket insert returned nothing");

      const messageIds = new Map<string, string>();
      for (const message of ticket.messages) {
        const [written] = await tx
          .insert(messages)
          .values({
            ticketId: row.id,
            authorType: message.author.type,
            authorCustomerId:
              message.author.type === "customer"
                ? idOf(customerIds, message.author.key)
                : null,
            authorAgentId:
              message.author.type === "agent"
                ? idOf(agentIds, message.author.key)
                : null,
            visibility: message.visibility,
            body: message.body,
            createdAt: message.createdAt,
          })
          .returning({ id: messages.id });
        if (written === undefined)
          throw new Error("message insert returned nothing");
        messageIds.set(message.key, written.id);
      }

      await tx.insert(auditEvents).values(
        ticket.audit.map((event) => ({
          ticketId: row.id,
          entityType: event.messageKey === null ? "ticket" : "message",
          entityId:
            event.messageKey === null
              ? row.id
              : idOf(messageIds, event.messageKey),
          action: event.action,
          ...actorColumns(event.actor, customerIds, agentIds),
          before: resolve(event.before, agentIds),
          after: resolve(event.after, agentIds),
          requestId: event.requestId,
          createdAt: event.createdAt,
        })),
      );
    }

    if (plan.staffAudit.length > 0) {
      await tx.insert(auditEvents).values(
        plan.staffAudit.map((event) => ({
          ticketId: null,
          entityType: "agent",
          entityId: idOf(agentIds, event.agentKey),
          action: event.action,
          actorType: "agent" as const,
          actorAgentId: idOf(agentIds, event.actorKey),
          before: null,
          after: resolve(event.after, agentIds),
          requestId: event.requestId,
          createdAt: event.createdAt,
        })),
      );
    }

    await tx.insert(cannedResponses).values(
      plan.cannedResponses.map((response) => ({
        brandId: brand.id,
        title: response.title,
        body: response.body,
        createdByAgentId: idOf(agentIds, response.createdByKey),
        updatedByAgentId: idOf(agentIds, response.createdByKey),
        createdAt: response.createdAt,
        updatedAt: response.createdAt,
      })),
    );
  });
}
