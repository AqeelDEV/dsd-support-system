import { en, Faker } from "@faker-js/faker";
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type AgentRole,
  type AuditAction,
  type MessageVisibility,
  type TicketPriority,
  type TicketStatus,
} from "@dsd/shared";

import {
  CANNED_RESPONSES,
  type Category,
  PRODUCTS,
  SCENARIOS,
  type Scenario,
} from "./catalog.js";
import { KB_ARTICLES, KB_CATEGORIES } from "./kb-catalog.js";

/**
 * Builds the demo dataset as plain data, without touching the database.
 * The same seed and anchor always produce the same plan: every random
 * choice comes from a seeded faker instance, and every timestamp is an
 * offset from `anchor`.
 */

export const FAKER_SEED = 20_260_930;

/** Shared by every demo account. The README lists the accounts. */
export const DEMO_PASSWORD = "dsd-demo-password";

export const DEMO_BRAND = {
  slug: "dsd",
  name: "DSD",
  ticketPrefix: "DSD",
  supportEmail: "support@dsd.example",
} as const;

/** A reference to an agent by plan key, resolved to an ID when written. */
export interface AgentRef {
  $agent: string;
}

export type Actor =
  | { type: "customer"; key: string }
  | { type: "agent"; key: string }
  | { type: "system" };

export type Json =
  | string
  | number
  | boolean
  | null
  | AgentRef
  | Json[]
  | { [key: string]: Json };

export interface PlannedAgent {
  key: string;
  email: string;
  displayName: string;
  role: AgentRole;
  hasPassword: boolean;
  invitedByKey: string | null;
  createdAt: Date;
  deactivatedAt: Date | null;
}

export interface PlannedCustomer {
  key: string;
  email: string;
  displayName: string | null;
  /** Registered customers have a verified email and a password. Guests have neither. */
  registered: boolean;
  createdAt: Date;
}

export interface PlannedMessage {
  key: string;
  author: Extract<Actor, { type: "customer" | "agent" }>;
  visibility: MessageVisibility;
  body: string;
  createdAt: Date;
}

export interface PlannedAudit {
  action: AuditAction;
  actor: Actor;
  /** The ticket itself, or one of its messages. */
  messageKey: string | null;
  before: Json;
  after: Json;
  createdAt: Date;
  requestId: string;
}

export interface PlannedTicket {
  key: string;
  customerKey: string;
  subject: string;
  description: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeKey: string | null;
  contactVerifiedAt: Date | null;
  escalatedAt: Date | null;
  escalatedByKey: string | null;
  firstResponseAt: Date | null;
  resolvedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages: PlannedMessage[];
  audit: PlannedAudit[];
}

export interface PlannedStaffAudit {
  action: Extract<AuditAction, "agent.invited" | "agent.deactivated">;
  actorKey: string;
  agentKey: string;
  after: Json;
  createdAt: Date;
  requestId: string;
}

export interface SeedPlan {
  brand: typeof DEMO_BRAND;
  agents: PlannedAgent[];
  customers: PlannedCustomer[];
  tickets: PlannedTicket[];
  staffAudit: PlannedStaffAudit[];
  cannedResponses: {
    title: string;
    body: string;
    createdByKey: string;
    createdAt: Date;
  }[];
  kbCategories: {
    key: Category;
    slug: string;
    name: string;
    position: number;
    createdAt: Date;
  }[];
  kbArticles: PlannedArticle[];
}

/** A knowledge-base article, written by the supervisor and published a day later unless it is a draft. */
export interface PlannedArticle {
  categoryKey: Category;
  slug: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  authorKey: string;
  createdAt: Date;
  /** Null for a draft. */
  publishedAt: Date | null;
  requestId: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const TICKET_COUNT = 60;
/** Tickets escalated to a supervisor, by position. */
const ESCALATED = new Set([6, 21, 38]);

export function generateSeedPlan(anchor: Date): SeedPlan {
  const faker = new Faker({ locale: [en] });
  faker.seed(FAKER_SEED);
  const at = (offsetMs: number) => new Date(anchor.getTime() - offsetMs);
  const requestId = () => faker.string.uuid();

  // Staff. Demo accounts use role-named addresses; the rest are synthetic.
  const person = () => {
    const firstName = faker.person.firstName();
    const lastName = faker.person.lastName();
    return { firstName, lastName, displayName: `${firstName} ${lastName}` };
  };
  const agents: PlannedAgent[] = [];
  const addAgent = (
    key: string,
    role: AgentRole,
    email: string,
    invitedByKey: string | null,
    options: {
      hasPassword?: boolean;
      createdDaysAgo: number;
      deactivatedDaysAgo?: number;
    },
  ) => {
    agents.push({
      key,
      email,
      displayName: person().displayName,
      role,
      hasPassword: options.hasPassword ?? true,
      invitedByKey,
      createdAt: at(options.createdDaysAgo * DAY),
      deactivatedAt:
        options.deactivatedDaysAgo === undefined
          ? null
          : at(options.deactivatedDaysAgo * DAY),
    });
  };
  addAgent("admin", "admin", "admin@dsd.example", null, {
    createdDaysAgo: 120,
  });
  addAgent("supervisor", "supervisor", "supervisor@dsd.example", "admin", {
    createdDaysAgo: 110,
  });
  addAgent("agent", "agent", "agent@dsd.example", "admin", {
    createdDaysAgo: 100,
  });
  for (let index = 1; index <= 4; index += 1) {
    const { firstName, lastName } = person();
    addAgent(
      `agent-${index}`,
      "agent",
      `${firstName}.${lastName}@dsd.example`.toLowerCase(),
      "supervisor",
      { createdDaysAgo: 90 - index * 5 },
    );
  }
  addAgent("former-agent", "agent", "former.agent@dsd.example", "admin", {
    createdDaysAgo: 80,
    deactivatedDaysAgo: 10,
  });
  addAgent("invited-agent", "agent", "new.starter@dsd.example", "supervisor", {
    createdDaysAgo: 2,
    hasPassword: false,
  });

  const workingAgents = ["agent", "agent-1", "agent-2", "agent-3", "agent-4"];
  const staffAudit: PlannedStaffAudit[] = agents
    .filter((agent) => agent.invitedByKey !== null)
    .map((agent) => ({
      action: "agent.invited" as const,
      actorKey: agent.invitedByKey ?? "admin",
      agentKey: agent.key,
      after: { role: agent.role },
      createdAt: agent.createdAt,
      requestId: requestId(),
    }));
  const former = agents.find((agent) => agent.key === "former-agent");
  if (former?.deactivatedAt) {
    staffAudit.push({
      action: "agent.deactivated",
      actorKey: "admin",
      agentKey: former.key,
      after: { deactivated: true },
      createdAt: former.deactivatedAt,
      requestId: requestId(),
    });
  }

  // Customers: the demo account, registered customers and guests.
  const customers: PlannedCustomer[] = [
    {
      key: "customer",
      email: "customer@example.com",
      displayName: person().displayName,
      registered: true,
      createdAt: at(60 * DAY),
    },
  ];
  const domains = ["example.com", "example.net", "example.org"] as const;
  for (let index = 1; index <= 19; index += 1) {
    const { firstName, lastName, displayName } = person();
    const registered = index <= 12;
    customers.push({
      key: `customer-${index}`,
      email:
        `${firstName}.${lastName}${index}@${faker.helpers.arrayElement(domains)}`.toLowerCase(),
      displayName: registered ? displayName : null,
      registered,
      createdAt: at(faker.number.int({ min: 45, max: 58 }) * DAY),
    });
  }
  const firstName = (key: string, fallback: string) => {
    const name =
      customers.find((customer) => customer.key === key)?.displayName ??
      agents.find((agent) => agent.key === key)?.displayName;
    return name?.split(" ")[0] ?? fallback;
  };

  const tickets: PlannedTicket[] = [];
  for (let index = 0; index < TICKET_COUNT; index += 1) {
    tickets.push(
      planTicket({
        index,
        faker,
        at,
        requestId,
        customerKey:
          index < 5
            ? "customer"
            : faker.helpers.arrayElement(
                customers.slice(1).map((customer) => customer.key),
              ),
        customers,
        workingAgents,
        firstName,
      }),
    );
  }

  return {
    brand: DEMO_BRAND,
    agents,
    customers,
    tickets,
    staffAudit,
    cannedResponses: CANNED_RESPONSES.map((response) => ({
      ...response,
      createdByKey: "supervisor",
      createdAt: at(70 * DAY),
    })),
    kbCategories: KB_CATEGORIES.map((category) => ({
      ...category,
      createdAt: at(80 * DAY),
    })),
    kbArticles: KB_ARTICLES.map((article, index) => ({
      categoryKey: article.category,
      slug: article.slug,
      title: article.title,
      summary: article.summary,
      body: article.body,
      tags: article.tags,
      authorKey: "supervisor",
      createdAt: at((78 - index) * DAY),
      publishedAt: article.published ? at((77 - index) * DAY) : null,
      requestId: requestId(),
    })),
  };
}

interface TicketContext {
  index: number;
  faker: Faker;
  at: (offsetMs: number) => Date;
  requestId: () => string;
  customerKey: string;
  customers: PlannedCustomer[];
  workingAgents: string[];
  firstName: (key: string, fallback: string) => string;
}

type Step =
  | { kind: "prioritise" }
  | { kind: "assign" }
  | { kind: "note" }
  | { kind: "reply"; to: TicketStatus }
  | { kind: "follow-up" }
  | { kind: "escalate" }
  | { kind: "resolve" }
  | { kind: "close" };

/** Picks a status. The first sixteen tickets cover every status and priority pair. */
function statusAndPriority(
  index: number,
  faker: Faker,
): [TicketStatus, TicketPriority] {
  if (index < 16) {
    return [
      TICKET_STATUSES[index % 4] ?? "open",
      TICKET_PRIORITIES[Math.floor(index / 4) % 4] ?? "normal",
    ];
  }
  const status = faker.helpers.weightedArrayElement<TicketStatus>([
    { value: "open", weight: 35 },
    { value: "pending_customer", weight: 20 },
    { value: "resolved", weight: 30 },
    { value: "closed", weight: 15 },
  ]);
  const priority = faker.helpers.weightedArrayElement<TicketPriority>([
    { value: "low", weight: 20 },
    { value: "normal", weight: 50 },
    { value: "high", weight: 22 },
    { value: "urgent", weight: 8 },
  ]);
  return [status, priority];
}

function planTicket(context: TicketContext): PlannedTicket {
  const { index, faker, at, requestId, customerKey } = context;
  const scenario: Scenario | undefined = SCENARIOS[index % SCENARIOS.length];
  if (scenario === undefined)
    throw new Error("the scenario catalogue is empty");
  const [status, finalPriority] = statusAndPriority(index, faker);
  const escalate =
    ESCALATED.has(index) &&
    (status === "open" || status === "pending_customer");
  const agentKey = faker.helpers.arrayElement(context.workingAgents);
  const customer = context.customers.find(
    (candidate) => candidate.key === customerKey,
  );

  const fill = (template: string, values: Record<string, string>) =>
    template.replace(
      /\{(\w+)\}/g,
      (match, name: string) => values[name] ?? match,
    );
  const values = {
    customer: context.firstName(customerKey, "there"),
    agent: context.firstName(agentKey, "the team"),
    product: faker.helpers.arrayElement(PRODUCTS),
    order: `${faker.string.numeric(4)}-${faker.string.numeric(4)}`,
    amount: `£${faker.commerce.price({ min: 19, max: 249 })}`,
    date: faker.date
      .recent({ days: 20, refDate: at(0) })
      .toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
      }),
    city: faker.location.city(),
  };
  const signed = (body: string) =>
    `${fill(body, values)}\n\n${values.agent}, DSD Support`;

  // The steps this ticket went through to reach its status.
  const newAndUntouched = status === "open" && index % 2 === 0 && !escalate;
  const steps: Step[] = [];
  if (finalPriority !== "normal" && !escalate)
    steps.push({ kind: "prioritise" });
  if (!newAndUntouched || index % 4 === 0) steps.push({ kind: "assign" });
  if (!newAndUntouched) {
    if (faker.datatype.boolean()) steps.push({ kind: "note" });
    steps.push({ kind: "reply", to: "pending_customer" });
    if (status !== "pending_customer") steps.push({ kind: "follow-up" });
    if (escalate) steps.push({ kind: "escalate" });
    if (escalate && status === "pending_customer")
      steps.push({ kind: "reply", to: "pending_customer" });
    if (status === "resolved" || status === "closed")
      steps.push({ kind: "resolve" });
    if (status === "closed") steps.push({ kind: "close" });
  }

  // Older tickets have more history; every step lands before the anchor.
  const minimumAgeDays = {
    open: 0.1,
    pending_customer: 1,
    resolved: 3,
    closed: 6,
  }[status];
  const ageMs = faker.number.int({ min: minimumAgeDays * DAY, max: 40 * DAY });
  const createdAt = at(ageMs);
  const weights = steps.map(() => faker.number.float({ min: 0.5, max: 1.5 }));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  const span = ageMs * 0.85;
  let clock = createdAt.getTime();
  const times = weights.map((weight) => {
    clock += Math.max(MINUTE, Math.round((span * weight) / totalWeight));
    return new Date(clock);
  });

  const ticketKey = `ticket-${index}`;
  const messages: PlannedMessage[] = [];
  const audit: PlannedAudit[] = [];
  const agent = { type: "agent" as const, key: agentKey };
  const customerActor = { type: "customer" as const, key: customerKey };
  const record = (
    action: AuditAction,
    actor: Actor,
    createdAtTime: Date,
    before: Json,
    after: Json,
    messageKey: string | null = null,
  ) => {
    audit.push({
      action,
      actor,
      messageKey,
      before,
      after,
      createdAt: createdAtTime,
      requestId: requestId(),
    });
  };
  const post = (
    author: PlannedMessage["author"],
    visibility: MessageVisibility,
    body: string,
    createdAtTime: Date,
  ) => {
    const key = `${ticketKey}-message-${messages.length}`;
    messages.push({ key, author, visibility, body, createdAt: createdAtTime });
    record("message.created", author, createdAtTime, null, { visibility }, key);
  };

  record("ticket.created", customerActor, createdAt, null, {
    status: "open",
    priority: "normal",
    channel: "web",
  });

  let currentStatus: TicketStatus = "open";
  let priority: TicketPriority = "normal";
  let assigneeKey: string | null = null;
  let firstResponseAt: Date | null = null;
  let resolvedAt: Date | null = null;
  let closedAt: Date | null = null;
  let escalatedAt: Date | null = null;
  let escalatedByKey: string | null = null;
  const moveTo = (next: TicketStatus, actor: Actor, time: Date) => {
    record(
      "ticket.status_changed",
      actor,
      time,
      { status: currentStatus },
      { status: next },
    );
    currentStatus = next;
  };

  steps.forEach((step, position) => {
    const time = times[position] ?? createdAt;
    switch (step.kind) {
      case "prioritise":
        record(
          "ticket.priority_changed",
          agent,
          time,
          { priority },
          { priority: finalPriority },
        );
        priority = finalPriority;
        break;
      case "assign":
        record(
          "ticket.assigned",
          agent,
          time,
          { assigneeAgentId: null },
          {
            assigneeAgentId: { $agent: agentKey },
          },
        );
        assigneeKey = agentKey;
        break;
      case "note":
        post(agent, "internal", fill(scenario.internalNote, values), time);
        break;
      case "reply":
        post(agent, "public", signed(scenario.agentReply), time);
        firstResponseAt ??= time;
        if (currentStatus !== step.to) moveTo(step.to, agent, time);
        break;
      case "follow-up":
        // A customer reply reopens the ticket automatically (ADR-0007).
        post(
          customerActor,
          "public",
          fill(scenario.customerFollowUp, values),
          time,
        );
        moveTo("open", customerActor, time);
        break;
      case "escalate": {
        const raised: TicketPriority =
          finalPriority === "urgent" ? "urgent" : "high";
        post(
          agent,
          "internal",
          `Escalating to a supervisor: the customer has been waiting and the usual fix didn't work. ${fill(scenario.internalNote, values)}`,
          time,
        );
        record(
          "ticket.escalated",
          agent,
          time,
          { escalated: false },
          {
            escalated: true,
            assigneeAgentId: { $agent: "supervisor" },
          },
        );
        if (raised !== priority) {
          record(
            "ticket.priority_changed",
            agent,
            time,
            { priority },
            { priority: raised },
          );
          priority = raised;
        }
        record(
          "ticket.assigned",
          agent,
          time,
          {
            assigneeAgentId:
              assigneeKey === null ? null : { $agent: assigneeKey },
          },
          {
            assigneeAgentId: { $agent: "supervisor" },
          },
        );
        assigneeKey = "supervisor";
        escalatedAt = time;
        escalatedByKey = agentKey;
        break;
      }
      case "resolve":
        post(agent, "public", signed(scenario.resolution), time);
        firstResponseAt ??= time;
        moveTo("resolved", agent, time);
        resolvedAt = time;
        break;
      case "close":
        moveTo("closed", agent, time);
        closedAt = time;
        break;
    }
  });

  const verifiedAt = customer?.registered
    ? createdAt
    : faker.number.int({ min: 1, max: 10 }) <= 7
      ? new Date(
          createdAt.getTime() + faker.number.int({ min: 2, max: 50 }) * MINUTE,
        )
      : null;
  const lastEvent = times.at(-1) ?? createdAt;

  return {
    key: ticketKey,
    customerKey,
    subject: fill(scenario.subject, values),
    description: fill(scenario.description, values),
    status: currentStatus,
    priority,
    assigneeKey,
    contactVerifiedAt: verifiedAt,
    escalatedAt,
    escalatedByKey,
    firstResponseAt,
    resolvedAt,
    closedAt,
    createdAt,
    updatedAt: lastEvent,
    messages,
    audit,
  };
}
