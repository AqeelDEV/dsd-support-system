"use client";

import { ApiProblem } from "@dsd/api-client";
import type { AuditEvent, StaffTicket } from "@dsd/shared";
import {
  AttachmentList,
  Avatar,
  buttonVariants,
  ErrorState,
  format,
  PriorityBadge,
  ReferenceChip,
  RelativeTime,
  Skeleton,
  StatusBadge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Thread,
  ThreadEvent,
  ThreadMessage,
} from "@dsd/ui";
import { ArrowLeft, Flame, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { PRODUCT_NAME } from "@/components/brand";
import { LoadError } from "@/components/page";
import { describeEvent } from "@/lib/activity";
import { attachmentHref } from "@/lib/api";
import { useAssignable, useAuditTrail, useTicket } from "@/lib/tickets";

import { AssistPanel } from "./assist-panel";
import { Composer, type ComposerHandle } from "./composer";
import { CustomerCard } from "./customer-card";
import { Properties } from "./properties";

type Entry =
  | { kind: "message"; at: string; message: StaffTicket["messages"][number] }
  | { kind: "event"; at: string; event: AuditEvent };

export function TicketView({ ticketId }: { ticketId: string }) {
  const ticket = useTicket(ticketId);
  const canAudit = ticket.data?.allowedActions.viewAuditTrail ?? false;
  const audit = useAuditTrail(ticketId, canAudit);
  const colleagues = useAssignable(ticket.data !== undefined);
  const composer = useRef<ComposerHandle>(null);

  if (ticket.isPending) return <TicketSkeleton />;
  if (ticket.isError) {
    const missing =
      ticket.error instanceof ApiProblem && ticket.error.status === 404;
    return (
      <div className="grid flex-1 place-items-center p-6">
        {missing ? (
          <ErrorState
            title="No such ticket"
            description="It may be in a brand you don't work on, or the link may be wrong."
            action={
              <Link href="/queue" className={buttonVariants({ size: "sm" })}>
                Back to the queue
              </Link>
            }
          />
        ) : (
          <LoadError
            error={ticket.error}
            onRetry={() => void ticket.refetch()}
            what="tickets"
          />
        )}
      </div>
    );
  }

  const data = ticket.data;
  const events = audit.data?.items ?? [];
  // Names for the agent IDs in events: colleagues who can take tickets, the
  // people on this ticket, and whoever acted in its history (a deactivated
  // colleague still has a name there).
  const names = new Map<string, string>();
  for (const event of events) {
    if (
      event.actor.type === "agent" &&
      event.actor.id !== null &&
      event.actor.name !== null
    ) {
      names.set(event.actor.id, event.actor.name);
    }
  }
  for (const agent of [data.assignee, data.escalatedBy]) {
    if (agent !== null) names.set(agent.id, agent.displayName);
  }
  for (const agent of colleagues.data?.items ?? [])
    names.set(agent.id, agent.displayName);
  const nameOf = (id: string) => names.get(id);

  const entries: Entry[] = [
    ...data.messages.map((message) => ({
      kind: "message" as const,
      at: message.createdAt,
      message,
    })),
    ...events
      .filter((event) => describeEvent(event, nameOf).onRail)
      .map((event) => ({ kind: "event" as const, at: event.createdAt, event })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  const files = (attachments: StaffTicket["attachments"]) =>
    attachments.length === 0 ? undefined : (
      <AttachmentList
        attachments={attachments}
        hrefFor={(attachment) => attachmentHref(data.id, attachment.id)}
      />
    );
  const customerName = data.customer.displayName ?? data.customer.email;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <title>{`${data.reference} ${data.subject} · ${PRODUCT_NAME}`}</title>
      <header className="border-b border-border bg-card px-4 py-3 sm:px-6">
        <Link
          href="/queue"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Queue
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-balance">
          {data.subject}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <ReferenceChip reference={data.reference} />
          <StatusBadge status={data.status} />
          <PriorityBadge priority={data.priority} />
          {data.escalatedAt === null ? null : (
            <span className="inline-flex items-center gap-1 font-medium text-tone-danger-fg">
              <Flame aria-hidden="true" className="size-3.5" />
              Escalated
            </span>
          )}
          <span>
            Opened <RelativeTime value={data.createdAt} /> by {customerName}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 p-4 sm:p-6">
          <Tabs defaultValue="conversation">
            <TabsList aria-label="Ticket views">
              <TabsTrigger value="conversation">Conversation</TabsTrigger>
              {canAudit ? (
                <TabsTrigger value="activity">Activity</TabsTrigger>
              ) : null}
            </TabsList>
            <TabsContent
              value="conversation"
              className="mt-5 flex flex-col gap-6 outline-none"
            >
              <Thread>
                <ThreadMessage
                  author={customerName}
                  tag="Customer"
                  createdAt={data.createdAt}
                  body={data.description}
                  attachments={files(data.attachments)}
                  emphasis
                />
                {entries.map((entry) => {
                  if (entry.kind === "event") {
                    const described = describeEvent(entry.event, nameOf);
                    return (
                      <ThreadEvent
                        key={entry.event.id}
                        at={entry.at}
                        tone={described.tone}
                      >
                        <span className="font-medium text-foreground">
                          {entry.event.actor.name ?? "System"}
                        </span>{" "}
                        · {described.text}
                      </ThreadEvent>
                    );
                  }
                  const message = entry.message;
                  const fromCustomer = message.author.type === "customer";
                  return (
                    <ThreadMessage
                      key={message.id}
                      author={
                        fromCustomer
                          ? customerName
                          : (message.author.name ?? "Agent")
                      }
                      tag={
                        fromCustomer ? (
                          "Customer"
                        ) : message.visibility ===
                          "internal" ? undefined : message.aiSuggestionId ===
                          null ? (
                          "Reply"
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            Reply ·
                            <Sparkles aria-hidden="true" className="size-3" />
                            AI-assisted
                          </span>
                        )
                      }
                      variant={
                        message.visibility === "internal" ? "note" : "message"
                      }
                      emphasis={fromCustomer}
                      createdAt={message.createdAt}
                      body={message.body}
                      attachments={files(message.attachments)}
                    />
                  );
                })}
              </Thread>
              <Composer ticket={data} ref={composer} />
              {data.allowedActions.reply ||
              data.allowedActions.addNote ? null : (
                <p className="text-sm text-muted-foreground">
                  This ticket can&apos;t take replies.
                </p>
              )}
            </TabsContent>
            {canAudit ? (
              <TabsContent value="activity" className="mt-5 outline-none">
                <Activity
                  events={events}
                  loading={audit.isPending}
                  nameOf={nameOf}
                />
              </TabsContent>
            ) : null}
          </Tabs>
        </div>

        <aside
          aria-label="Ticket details"
          className="divide-y divide-border border-t border-border bg-card lg:border-t-0 lg:border-l"
        >
          <AssistPanel
            ticket={data}
            onInsert={(draft, suggestionId) => {
              composer.current?.insertSuggestion(draft, suggestionId);
            }}
          />
          <Properties ticket={data} />
          <CustomerCard ticket={data} />
          <dl className="grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1.5 px-4 py-3 text-xs">
            <dt className="text-muted-foreground">Channel</dt>
            <dd className="capitalize">{data.channel}</dd>
            <dt className="text-muted-foreground">Opened</dt>
            <dd>{format.dateTime(data.createdAt)}</dd>
            <dt className="text-muted-foreground">First response</dt>
            <dd>
              {data.firstResponseAt === null
                ? "Not yet"
                : format.dateTime(data.firstResponseAt)}
            </dd>
            {data.resolvedAt === null ? null : (
              <>
                <dt className="text-muted-foreground">Resolved</dt>
                <dd>{format.dateTime(data.resolvedAt)}</dd>
              </>
            )}
          </dl>
        </aside>
      </div>
    </div>
  );
}

function Activity({
  events,
  loading,
  nameOf,
}: {
  events: readonly AuditEvent[];
  loading: boolean;
  nameOf: (id: string) => string | undefined;
}) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-10" />
        ))}
      </div>
    );
  }
  return (
    <ol
      className="divide-y divide-border rounded-lg border border-border bg-card"
      aria-label="Activity"
    >
      {events.map((event) => (
        <li key={event.id} className="flex items-center gap-3 px-4 py-2.5">
          <Avatar name={event.actor.name ?? "System"} size="sm" />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">{event.actor.name ?? "System"}</span>{" "}
            <span className="text-muted-foreground">
              {describeEvent(event, nameOf).text}
            </span>
          </p>
          <span
            className="shrink-0 text-xs text-muted-foreground"
            title={format.dateTime(event.createdAt)}
          >
            <RelativeTime value={event.createdAt} />
          </span>
        </li>
      ))}
    </ol>
  );
}

function TicketSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-1 flex-col">
      <div className="space-y-2 border-b border-border bg-card px-6 py-4">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid flex-1 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-5 p-6">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-36" />
        </div>
        <div className="hidden space-y-3 border-l border-border bg-card p-4 lg:block">
          <Skeleton className="h-8" />
          <Skeleton className="h-8" />
          <Skeleton className="h-24" />
        </div>
      </div>
    </div>
  );
}
