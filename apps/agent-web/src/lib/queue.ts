import {
  QUEUE_SORTS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  type TicketPriority,
  type TicketStatus,
} from "@dsd/shared";

/*
 * The queue's filters live in the URL, so a view can be bookmarked, shared
 * with a colleague and restored with the back button. They map one to one
 * onto the API's queue query (ADR-0011); the API applies them.
 */

export type QueueSort = (typeof QUEUE_SORTS)[number];

export interface QueueFilters {
  status: TicketStatus[];
  priority: TicketPriority[];
  /** `me`, `unassigned` or an agent's ID. */
  assignee?: string | undefined;
  escalated?: boolean | undefined;
  sort: QueueSort;
}

export interface QueueView {
  id: string;
  label: string;
  filters: Omit<QueueFilters, "sort" | "priority">;
}

/** Saved views for the common ways of working the queue. */
export const VIEWS: readonly QueueView[] = [
  {
    id: "mine",
    label: "My tickets",
    filters: { status: ["open", "pending_customer"], assignee: "me" },
  },
  {
    id: "unassigned",
    label: "Unassigned",
    filters: { status: ["open"], assignee: "unassigned" },
  },
  { id: "open", label: "All open", filters: { status: ["open"] } },
  {
    id: "waiting",
    label: "Awaiting customer",
    filters: { status: ["pending_customer"] },
  },
  {
    id: "escalated",
    label: "Escalated",
    filters: { status: ["open", "pending_customer"], escalated: true },
  },
  { id: "resolved", label: "Resolved", filters: { status: ["resolved"] } },
];

const DEFAULT_SORT: QueueSort = "priority";

const pick = <T extends string>(values: readonly T[], allowed: readonly T[]) =>
  [...new Set(values)].filter((value): value is T => allowed.includes(value));

/** Filters from the address bar; anything unknown is ignored. Without a status, the queue shows open tickets. */
export function parseFilters(params: URLSearchParams): QueueFilters {
  const status = pick(
    params.getAll("status") as TicketStatus[],
    TICKET_STATUSES,
  );
  const sort = params.get("sort") as QueueSort | null;
  const escalated = params.get("escalated");
  const assignee = params.get("assignee");
  return {
    status: status.length === 0 ? ["open"] : status,
    priority: pick(
      params.getAll("priority") as TicketPriority[],
      TICKET_PRIORITIES,
    ),
    assignee: assignee === null || assignee === "" ? undefined : assignee,
    escalated:
      escalated === "true" ? true : escalated === "false" ? false : undefined,
    sort: sort !== null && QUEUE_SORTS.includes(sort) ? sort : DEFAULT_SORT,
  };
}

/** The address-bar form of some filters, the default sort left out. */
export function toSearch(filters: QueueFilters): string {
  const params = new URLSearchParams();
  for (const status of filters.status) params.append("status", status);
  for (const priority of filters.priority) params.append("priority", priority);
  if (filters.assignee !== undefined) params.set("assignee", filters.assignee);
  if (filters.escalated !== undefined) {
    params.set("escalated", String(filters.escalated));
  }
  if (filters.sort !== DEFAULT_SORT) params.set("sort", filters.sort);
  return params.toString();
}

/** The API query for one page of the queue. */
export function toQuery(filters: QueueFilters, cursor?: string) {
  return {
    status: filters.status,
    ...(filters.priority.length === 0 ? {} : { priority: filters.priority }),
    ...(filters.assignee === undefined ? {} : { assignee: filters.assignee }),
    ...(filters.escalated === undefined
      ? {}
      : { escalated: String(filters.escalated) }),
    sort: filters.sort,
    limit: 50,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value) => b.includes(value));

/** The saved view these filters match, if any (sort and priority aside). */
export function viewOf(filters: QueueFilters): QueueView | undefined {
  return VIEWS.find(
    (view) =>
      sameSet(view.filters.status, filters.status) &&
      view.filters.assignee === filters.assignee &&
      view.filters.escalated === filters.escalated,
  );
}

/** A view's filters, keeping the current sort and priority. */
export function withView(view: QueueView, current: QueueFilters): QueueFilters {
  return { ...view.filters, sort: current.sort, priority: current.priority };
}
