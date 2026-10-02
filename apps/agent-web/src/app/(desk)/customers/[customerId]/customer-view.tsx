"use client";

import { ok } from "@dsd/api-client";
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  format,
  Panel,
  Skeleton,
} from "@dsd/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Inbox } from "lucide-react";

import { LoadError, PageBody, PageHeader } from "@/components/page";
import { TicketTable } from "@/components/ticket-rows";
import { api } from "@/lib/api";

/** One customer and every ticket they've raised in your brands (FR-8). */
export function CustomerView({ customerId }: { customerId: string }) {
  const customer = useInfiniteQuery({
    queryKey: ["customer", customerId, "all"],
    queryFn: ({ pageParam }) =>
      ok(
        api.GET("/api/v1/staff/customers/{customerId}", {
          params: {
            path: { customerId },
            query: {
              limit: 50,
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.tickets.nextCursor ?? undefined,
  });

  if (customer.isError) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <LoadError
          error={customer.error}
          onRetry={() => void customer.refetch()}
          what="customer records"
        />
      </div>
    );
  }

  const first = customer.data?.pages[0]?.customer;
  const tickets =
    customer.data?.pages.flatMap((page) => page.tickets.items) ?? [];
  const name = first?.displayName ?? first?.email ?? "";

  return (
    <>
      <PageHeader
        title={
          first === undefined ? (
            "Customer"
          ) : (
            <span className="flex items-center gap-3">
              <Avatar name={name} />
              {name}
            </span>
          )
        }
        description={
          first === undefined ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              {first.email}
              <Badge>{first.hasAccount ? "Has an account" : "Guest"}</Badge>
              <span>Customer since {format.date(first.createdAt)}</span>
            </span>
          )
        }
      />
      <PageBody className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Tickets</h2>
        <Panel className="overflow-hidden" aria-busy={customer.isPending}>
          {customer.isPending ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : tickets.length === 0 ? (
            <EmptyState icon={Inbox} title="No tickets in your brands" />
          ) : (
            <TicketTable tickets={tickets} label={`Tickets from ${name}`} />
          )}
        </Panel>
        {customer.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              pending={customer.isFetchingNextPage}
              onClick={() => void customer.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
