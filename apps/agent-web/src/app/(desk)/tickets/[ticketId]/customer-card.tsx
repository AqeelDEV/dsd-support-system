"use client";

import type { StaffTicket } from "@dsd/shared";
import {
  Avatar,
  Badge,
  ReferenceChip,
  RelativeTime,
  Skeleton,
  StatusBadge,
  Tooltip,
} from "@dsd/ui";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { useCan } from "@/lib/session";
import { useCustomer } from "@/lib/tickets";

/**
 * Who the customer is and what else they've asked (FR-8). An unverified
 * contact (a guest who hasn't opened their emailed link) is flagged, so the
 * agent doesn't share account details with whoever typed the address
 * (ADR-0003, section 6).
 */
export function CustomerCard({ ticket }: { ticket: StaffTicket }) {
  const can = useCan();
  const history = useCustomer(
    can("customer:read") ? ticket.customer.id : undefined,
  );
  const others = (history.data?.tickets.items ?? []).filter(
    (item) => item.id !== ticket.id,
  );
  const name = ticket.customer.displayName ?? ticket.customer.email;

  return (
    <section aria-labelledby="customer-heading" className="px-4 py-3">
      <h2
        id="customer-heading"
        className="text-xs font-medium text-muted-foreground"
      >
        Customer
      </h2>
      <div className="mt-2 flex items-start gap-2.5">
        <Avatar name={name} />
        <div className="min-w-0">
          {can("customer:read") ? (
            <Link
              href={`/customers/${ticket.customer.id}`}
              className="block truncate text-sm font-medium hover:text-primary hover:underline"
            >
              {name}
            </Link>
          ) : (
            <p className="truncate text-sm font-medium">{name}</p>
          )}
          {ticket.customer.displayName === null ? null : (
            <p className="truncate text-xs text-muted-foreground">
              {ticket.customer.email}
            </p>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {ticket.contactVerified ? (
              <Tooltip content="They opened a link we emailed to this address">
                <Badge tone="success">
                  <ShieldCheck aria-hidden="true" className="size-3" />
                  Verified email
                </Badge>
              </Tooltip>
            ) : (
              <Tooltip content="A guest who hasn't opened our emailed link yet: don't share account details">
                <Badge tone="warning">
                  <ShieldAlert aria-hidden="true" className="size-3" />
                  Unverified contact
                </Badge>
              </Tooltip>
            )}
            <Badge>
              {ticket.customer.hasAccount ? "Has an account" : "Guest"}
            </Badge>
          </div>
        </div>
      </div>

      {can("customer:read") ? (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-muted-foreground">
            Other tickets
          </h3>
          {history.isPending ? (
            <div className="mt-2 space-y-2">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : history.isError ? (
            <p className="mt-2 text-xs text-muted-foreground">
              Their history didn&apos;t load.
            </p>
          ) : others.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              This is their only ticket.
            </p>
          ) : (
            <ul className="mt-1.5 flex flex-col">
              {others.slice(0, 5).map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/tickets/${item.id}`}
                    className="-mx-2 flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <span className="truncate text-sm">{item.subject}</span>
                    <span className="flex items-center gap-2 text-xs text-muted-foreground">
                      <ReferenceChip
                        reference={item.reference}
                        copyable={false}
                      />
                      <StatusBadge status={item.status} />
                      <RelativeTime
                        value={item.createdAt}
                        className="ml-auto"
                      />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {others.length > 5 ? (
            <Link
              href={`/customers/${ticket.customer.id}`}
              className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
            >
              All {others.length + 1} tickets
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
