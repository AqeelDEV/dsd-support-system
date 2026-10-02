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
  return async (session: CustomerMe | null): Promise<void> => {
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== SESSION_KEY[0],
    });
    // A `me` read sent before the new cookie existed (the header asks on
    // every page) may still be in flight; its "signed out" answer must not
    // land after this and undo the sign-in. Callers wait for this before
    // navigating.
    await client.cancelQueries({ queryKey: SESSION_KEY });
    client.setQueryData(SESSION_KEY, session);
  };
}

/** A full account, as opposed to a guest session or nobody. */
export const isAccount = (
  session: CustomerMe | null | undefined,
): session is CustomerMe => session?.guestTicketId === null;
