"use client";

import {
  Alert,
  Button,
  buttonVariants,
  EmptyState,
  ErrorState,
  describeProblem,
  Panel,
  ReferenceChip,
  RelativeTime,
  Skeleton,
  StatusBadge,
} from "@dsd/ui";
import { ChevronRight, Inbox } from "lucide-react";
import Link from "next/link";

import { Container, PageIntro } from "@/components/page";
import { useSession } from "@/lib/session";
import { useMyTickets } from "@/lib/tickets";

export function TicketsView() {
  const session = useSession();
  const tickets = useMyTickets();
  const items = tickets.data?.pages.flatMap((page) => page.items) ?? [];
  const guest = typeof session.data?.guestTicketId === "string";

  return (
    <Container className="py-10 sm:py-12">
      <PageIntro
        title="My requests"
        description="Every request you've sent us, newest first."
        actions={
          <Link href="/new" className={buttonVariants({ size: "lg" })}>
            New request
          </Link>
        }
      />
      {guest ? (
        <Alert
          tone="info"
          className="mt-6"
          title="You're viewing one request from an email link"
        >
          <Link href="/signup">Create an account</Link> with the same email to
          see all your requests here.
        </Alert>
      ) : null}
      <Panel className="mt-8 overflow-hidden">
        {tickets.isPending ? (
          <ul className="divide-y divide-border" aria-hidden="true">
            {Array.from({ length: 4 }, (_, index) => (
              <li key={index} className="flex items-center gap-4 px-5 py-4">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-5 w-20 rounded-full" />
              </li>
            ))}
          </ul>
        ) : tickets.isError ? (
          <ErrorState
            {...describeProblem(tickets.error)}
            onRetry={() => void tickets.refetch()}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No requests yet"
            description="When you contact support, your request and our replies will appear here."
            action={
              <Link href="/new" className={buttonVariants()}>
                Contact support
              </Link>
            }
          />
        ) : (
          <ul className="divide-y divide-border">
            {items.map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/tickets/${ticket.id}`}
                  className="group flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/60"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium group-hover:text-primary">
                      {ticket.subject}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                      <ReferenceChip
                        reference={ticket.reference}
                        copyable={false}
                      />
                      <span>
                        Opened <RelativeTime value={ticket.createdAt} />
                      </span>
                    </p>
                  </div>
                  <StatusBadge status={ticket.status} audience="customer" />
                  <ChevronRight
                    aria-hidden="true"
                    className="hidden size-4 shrink-0 text-subtle sm:block"
                  />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {tickets.hasNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            variant="secondary"
            pending={tickets.isFetchingNextPage}
            onClick={() => void tickets.fetchNextPage()}
          >
            Show older requests
          </Button>
        </div>
      ) : null}
    </Container>
  );
}
