"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import type { CustomerMe } from "@dsd/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export const SESSION_KEY = ["session"] as const;

/**
 * Who is signed in, from `GET /auth/customer/me`: `null` when nobody is.
 * A guest session (opened from an emailed link) sees one ticket only;
 * `guestTicketId` says which.
 */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<CustomerMe | null> => {
      try {
        return await ok(api.GET("/api/v1/auth/customer/me"));
      } catch (error) {
        if (error instanceof ApiProblem && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

/** After signing in or out: store the new session and drop everything cached for the old one. */
export function useSetSession() {
  const client = useQueryClient();
  return (session: CustomerMe | null) => {
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== SESSION_KEY[0],
    });
    client.setQueryData(SESSION_KEY, session);
  };
}

/** A full account, as opposed to a guest session or nobody. */
export const isAccount = (
  session: CustomerMe | null | undefined,
): session is CustomerMe => session?.guestTicketId === null;
