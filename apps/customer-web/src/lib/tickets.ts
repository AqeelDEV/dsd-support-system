"use client";

import { formDataBody, multipart, ok } from "@dsd/api-client";
import type { CustomerTicket } from "@dsd/shared";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { api } from "./api";

/** The signed-in customer's requests, newest first (FR-2, FR-3). */
export function useMyTickets() {
  return useInfiniteQuery({
    queryKey: ["tickets"],
    queryFn: ({ pageParam }) =>
      ok(
        api.GET("/api/v1/customer/tickets", {
          params: {
            query: {
              limit: 20,
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

const ticketKey = (id: string) => ["ticket", id] as const;

/** One request with its thread and status history. Refreshes every minute, so a reply shows up. */
export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketKey(id),
    queryFn: () =>
      ok(
        api.GET("/api/v1/customer/tickets/{ticketId}", {
          params: { path: { ticketId: id } },
        }),
      ),
    refetchInterval: 60_000,
  });
}

/** A customer's reply. The API answers with the updated ticket, which replaces the cached one. */
export function useReply(id: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ body, files }: { body: string; files: File[] }) =>
      ok(
        api.POST("/api/v1/customer/tickets/{ticketId}/messages", {
          params: { path: { ticketId: id } },
          body: multipart({ body }, files) as never,
          ...formDataBody,
        }),
      ),
    onSuccess: (ticket: CustomerTicket) => {
      client.setQueryData(ticketKey(id), ticket);
      void client.invalidateQueries({ queryKey: ["tickets"] });
    },
  });
}
