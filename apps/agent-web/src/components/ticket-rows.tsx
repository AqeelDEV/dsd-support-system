"use client";

import type { StaffTicketSummary } from "@dsd/shared";
import {
  Avatar,
  cn,
  PriorityBadge,
  ReferenceChip,
  RelativeTime,
  StatusBadge,
  Tooltip,
} from "@dsd/ui";
import { Flame } from "lucide-react";
import Link from "next/link";

/*
 * Ticket rows for the queue and a customer's history: a dense table on
 * desktop (36 px rows, sticky header) and stacked cards on a phone
 * (ADR-0013, density). Each row is one link, so it opens with Enter, a
 * click or a middle-click into a new tab.
 */

export function TicketTable({
  tickets,
  selected,
  label,
}: {
  tickets: readonly StaffTicketSummary[];
  /** The row picked with j/k, highlighted and kept in view. */
  selected?: number;
  label: string;
}) {
  return (
    <>
      <table
        className="hidden w-full table-fixed border-collapse md:table"
        aria-label={label}
      >
        <thead className="sticky top-0 z-10 bg-card">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="w-28 py-2 pl-4 font-medium">
              Priority
            </th>
            <th scope="col" className="w-28 py-2 font-medium">
              Reference
            </th>
            <th scope="col" className="py-2 font-medium">
              Subject
            </th>
            <th scope="col" className="w-40 py-2 font-medium">
              Status
            </th>
            <th scope="col" className="w-44 py-2 font-medium">
              Assignee
            </th>
            <th scope="col" className="w-28 py-2 pr-4 text-right font-medium">
              Opened
            </th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket, index) => (
            <Row
              key={ticket.id}
              ticket={ticket}
              selected={selected === index}
            />
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-border md:hidden" aria-label={label}>
        {tickets.map((ticket, index) => (
          <li key={ticket.id}>
            <Link
              href={`/tickets/${ticket.id}`}
              data-selected={selected === index || undefined}
              className="block px-4 py-3 hover:bg-muted/60 data-[selected]:bg-accent/60"
            >
              <div className="flex items-center gap-2">
                <ReferenceChip reference={ticket.reference} copyable={false} />
                <PriorityBadge priority={ticket.priority} />
                <span className="ml-auto text-xs text-muted-foreground">
                  <RelativeTime value={ticket.createdAt} />
                </span>
              </div>
              <p className="mt-1.5 line-clamp-2 font-medium">
                {ticket.subject}
              </p>
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                <StatusBadge status={ticket.status} />
                <span className="truncate">
                  {ticket.customer.displayName ?? ticket.customer.email}
                </span>
                <span className="ml-auto shrink-0">
                  {ticket.assignee?.displayName ?? "Unassigned"}
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

function Row({
  ticket,
  selected,
}: {
  ticket: StaffTicketSummary;
  selected: boolean;
}) {
  const href = `/tickets/${ticket.id}`;
  return (
    <tr
      data-selected={selected || undefined}
      className={cn(
        "group relative h-11 border-b border-border text-sm last:border-b-0 hover:bg-muted/60",
        "data-[selected]:bg-accent/60 data-[selected]:shadow-[inset_2px_0_0_var(--color-primary)]",
      )}
    >
      <td className="pl-4">
        <PriorityBadge priority={ticket.priority} />
      </td>
      <td>
        <ReferenceChip reference={ticket.reference} copyable={false} />
      </td>
      <td className="pr-4">
        <Link
          href={href}
          data-row-link
          className="block truncate font-medium outline-none after:absolute after:inset-0 focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
        >
          {ticket.escalatedAt === null ? null : (
            <Tooltip content="Escalated">
              <Flame
                aria-label="Escalated"
                className="relative z-10 mr-1.5 inline size-3.5 align-[-2px] text-tone-danger"
              />
            </Tooltip>
          )}
          {ticket.subject}
        </Link>
        <span className="block truncate text-xs text-muted-foreground">
          {ticket.customer.displayName ?? ticket.customer.email}
        </span>
      </td>
      <td>
        <StatusBadge status={ticket.status} />
      </td>
      <td>
        {ticket.assignee === null ? (
          <span className="text-muted-foreground">Unassigned</span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={ticket.assignee.displayName} size="sm" />
            <span className="truncate">{ticket.assignee.displayName}</span>
          </span>
        )}
      </td>
      <td className="pr-4 text-right text-muted-foreground">
        <RelativeTime value={ticket.createdAt} />
      </td>
    </tr>
  );
}
