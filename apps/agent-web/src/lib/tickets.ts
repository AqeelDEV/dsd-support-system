"use client";

import { formDataBody, multipart, ok } from "@dsd/api-client";
import type {
  AssignmentRequest,
  StaffTicket,
  TicketPriority,
  TicketStatus,
} from "@dsd/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api } from "./api";
import { type QueueFilters, toQuery } from "./queue";

/** The queue, refreshed in the background every 30 seconds (FR-7). */
export function useQueue(filters: QueueFilters) {
  return useInfiniteQuery({
    queryKey: ["queue", filters],
    queryFn: ({ pageParam }) =>
      ok(
        api.GET("/api/v1/staff/tickets", {
          params: { query: toQuery(filters, pageParam) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

/** Colleagues a ticket can be handed to (FR-11; ADR-0012 amendment). */
export function useAssignable(enabled = true) {
  return useQuery({
    queryKey: ["assignable"],
    queryFn: () => ok(api.GET("/api/v1/staff/agents/assignable")),
    staleTime: 5 * 60_000,
    enabled,
  });
}

const ticketKey = (id: string) => ["ticket", id] as const;

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKey(id),
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/tickets/{ticketId}", {
          params: { path: { ticketId: id } },
        }),
      ),
    refetchInterval: 60_000,
  });
}

export function useAuditTrail(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["ticket", id, "audit"],
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/tickets/{ticketId}/audit-events", {
          params: { path: { ticketId: id }, query: { limit: 100 } },
        }),
      ),
    enabled,
  });
}

export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: ["customer", id],
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/customers/{customerId}", {
          params: { path: { customerId: id ?? "" }, query: { limit: 25 } },
        }),
      ),
    enabled: id !== undefined,
  });
}

/**
 * Every change to a ticket answers with the updated ticket (ADR-0011), which
 * replaces the cached one: the controls redraw from its `allowedActions` and
 * `allowedTransitions` with no second request. Lists that show the ticket
 * refresh in the background.
 */
function useTicketChange<Input>(
  id: string,
  change: (input: Input) => Promise<StaffTicket>,
) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: change,
    onSuccess: (ticket) => {
      client.setQueryData(ticketKey(id), ticket);
      void client.invalidateQueries({ queryKey: ["ticket", id, "audit"] });
      void client.invalidateQueries({ queryKey: ["queue"] });
      void client.invalidateQueries({ queryKey: ["customer"] });
    },
    onError: () => {
      // A conflict means the ticket moved on under us: show what it is now.
      void client.invalidateQueries({ queryKey: ticketKey(id) });
    },
  });
}

const path = (id: string) => ({ params: { path: { ticketId: id } } });

export function useTicketActions(id: string) {
  return {
    reply: useTicketChange(
      id,
      ({
        body,
        status,
        aiSuggestionId,
        files,
      }: {
        body: string;
        status?: TicketStatus;
        /** The AI suggestion the reply was based on, if any (ADR-0006). */
        aiSuggestionId?: string;
        files: File[];
      }) =>
        ok(
          api.POST("/api/v1/staff/tickets/{ticketId}/replies", {
            ...path(id),
            body: multipart({ body, status, aiSuggestionId }, files) as never,
            ...formDataBody,
          }),
        ),
    ),
    note: useTicketChange(
      id,
      ({ body, files }: { body: string; files: File[] }) =>
        ok(
          api.POST("/api/v1/staff/tickets/{ticketId}/notes", {
            ...path(id),
            body: multipart({ body }, files) as never,
            ...formDataBody,
          }),
        ),
    ),
    status: useTicketChange(id, (status: TicketStatus) =>
      ok(
        api.PATCH("/api/v1/staff/tickets/{ticketId}/status", {
          ...path(id),
          body: { status },
        }),
      ),
    ),
    priority: useTicketChange(id, (priority: TicketPriority) =>
      ok(
        api.PATCH("/api/v1/staff/tickets/{ticketId}/priority", {
          ...path(id),
          body: { priority },
        }),
      ),
    ),
    assignment: useTicketChange(id, (body: AssignmentRequest) =>
      ok(
        api.POST("/api/v1/staff/tickets/{ticketId}/assignment", {
          ...path(id),
          body,
        }),
      ),
    ),
    escalate: useTicketChange(
      id,
      (body: { reason: string; supervisorId?: string }) =>
        ok(
          api.POST("/api/v1/staff/tickets/{ticketId}/escalate", {
            ...path(id),
            body,
          }),
        ),
    ),
  };
}
