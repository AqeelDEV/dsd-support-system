"use client";

import {
  Button,
  cn,
  EmptyState,
  Kbd,
  Panel,
  PRIORITY_LABELS,
  RelativeTime,
  Select,
  Skeleton,
  Tooltip,
} from "@dsd/ui";
import { TICKET_PRIORITIES, type TicketPriority } from "@dsd/shared";
import { Inbox, RefreshCw } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { isTyping } from "@/components/shortcuts";
import { LoadError, PageBody, PageHeader } from "@/components/page";
import { TicketTable } from "@/components/ticket-rows";
import {
  type QueueFilters,
  type QueueSort,
  parseFilters,
  toSearch,
  VIEWS,
  viewOf,
  withView,
} from "@/lib/queue";
import { useCan } from "@/lib/session";
import { useAssignable, useQueue } from "@/lib/tickets";

const EMPTY: Record<string, { title: string; description: string }> = {
  mine: {
    title: "Nothing assigned to you",
    description: "Pick up something from Unassigned.",
  },
  unassigned: {
    title: "Every open ticket has an owner",
    description: "Nothing is waiting to be picked up.",
  },
  escalated: {
    title: "No escalations",
    description: "Nothing has been escalated to a supervisor.",
  },
};

export function QueueView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const can = useCan();
  const filters = parseFilters(params);
  const view = viewOf(filters);
  const queue = useQueue(filters);
  const assignable = useAssignable(can("ticket:assign"));
  const tickets = useMemo(
    () => queue.data?.pages.flatMap((page) => page.items) ?? [],
    [queue.data],
  );
  const [selected, setSelected] = useState(0);

  const go = (next: QueueFilters) => {
    setSelected(0);
    router.replace(`${pathname}?${toSearch(next)}`, { scroll: false });
  };

  // j/k move through the rows, Enter opens the selected ticket.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        isTyping(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      if (event.key === "j" || event.key === "k") {
        event.preventDefault();
        setSelected((index) =>
          Math.max(
            0,
            Math.min(tickets.length - 1, index + (event.key === "j" ? 1 : -1)),
          ),
        );
      } else if (event.key === "Enter" && tickets[selected] !== undefined) {
        const target = event.target as HTMLElement | null;
        if (target?.closest("a, button") !== null && target !== document.body)
          return;
        event.preventDefault();
        router.push(`/tickets/${tickets[selected].id}`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [tickets, selected, router]);

  useEffect(() => {
    document
      .querySelector("tr[data-selected]")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const empty = EMPTY[view?.id ?? ""] ?? {
    title: "No tickets match",
    description: "Try another view or clear the filters.",
  };

  return (
    <>
      <PageHeader
        title={view?.label ?? "Queue"}
        actions={
          <>
            <span
              className="hidden text-xs text-muted-foreground sm:inline"
              aria-live="polite"
            >
              {queue.dataUpdatedAt === 0 ? null : (
                <>
                  Updated{" "}
                  <RelativeTime
                    value={new Date(queue.dataUpdatedAt).toISOString()}
                  />
                </>
              )}
            </span>
            <Tooltip content="Refresh">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Refresh the queue"
                onClick={() => void queue.refetch()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={cn(queue.isFetching && "animate-spin")}
                />
              </Button>
            </Tooltip>
          </>
        }
      >
        <nav aria-label="Views" className="-mb-px flex gap-4 overflow-x-auto">
          {VIEWS.map((item) => {
            const current = view?.id === item.id;
            return (
              <Link
                key={item.id}
                href={`/queue?${toSearch(withView(item, filters))}`}
                aria-current={current ? "page" : undefined}
                onClick={() => {
                  setSelected(0);
                }}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center border-b-2 text-sm font-medium transition-colors",
                  current
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </PageHeader>

      <PageBody className="flex flex-col gap-3">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Filters"
        >
          <label className="sr-only" htmlFor="queue-priority">
            Priority
          </label>
          <Select
            id="queue-priority"
            size="sm"
            className="w-40"
            value={filters.priority[0] ?? ""}
            onChange={(event) => {
              const value = event.target.value as TicketPriority | "";
              go({ ...filters, priority: value === "" ? [] : [value] });
            }}
          >
            <option value="">Any priority</option>
            {[...TICKET_PRIORITIES].reverse().map((priority) => (
              <option key={priority} value={priority}>
                {PRIORITY_LABELS[priority]}
              </option>
            ))}
          </Select>
          {can("ticket:assign") ? (
            <>
              <label className="sr-only" htmlFor="queue-assignee">
                Assignee
              </label>
              <Select
                id="queue-assignee"
                size="sm"
                className="w-48"
                value={filters.assignee ?? ""}
                onChange={(event) => {
                  const value = event.target.value;
                  go({
                    ...filters,
                    assignee: value === "" ? undefined : value,
                  });
                }}
              >
                <option value="">Anyone</option>
                <option value="me">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
                {(assignable.data?.items ?? []).map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.displayName}
                  </option>
                ))}
              </Select>
            </>
          ) : null}
          <label className="sr-only" htmlFor="queue-sort">
            Sort
          </label>
          <Select
            id="queue-sort"
            size="sm"
            className="w-44"
            value={filters.sort}
            onChange={(event) => {
              go({ ...filters, sort: event.target.value as QueueSort });
            }}
          >
            <option value="priority">Most urgent first</option>
            <option value="oldest">Oldest first</option>
            <option value="newest">Newest first</option>
          </Select>
          <p className="ml-auto hidden items-center gap-1.5 text-xs text-muted-foreground lg:flex">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd> to move, <Kbd>Enter</Kbd> to open, <Kbd>?</Kbd> for all
            shortcuts
          </p>
        </div>

        <Panel className="overflow-hidden" aria-busy={queue.isPending}>
          {queue.isPending ? (
            <div className="divide-y divide-border" aria-hidden="true">
              {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="flex h-11 items-center gap-4 px-4">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-24" />
                </div>
              ))}
            </div>
          ) : queue.isError ? (
            <LoadError
              error={queue.error}
              onRetry={() => void queue.refetch()}
              what="the queue"
            />
          ) : tickets.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={empty.title}
              description={empty.description}
            />
          ) : (
            <TicketTable
              tickets={tickets}
              selected={selected}
              label="Tickets"
            />
          )}
        </Panel>
        {queue.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              pending={queue.isFetchingNextPage}
              onClick={() => void queue.fetchNextPage()}
            >
              Load more tickets
            </Button>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
