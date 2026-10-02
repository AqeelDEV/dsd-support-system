"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import type { Permission, StaffMe } from "@dsd/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";

export const SESSION_KEY = ["session"] as const;

/** Who is signed in (`GET /auth/staff/me`), or `null` when nobody is. */
export function useSession() {
  return useQuery({
    queryKey: SESSION_KEY,
    queryFn: async (): Promise<StaffMe | null> => {
      try {
        return await ok(api.GET("/api/v1/auth/staff/me"));
      } catch (error) {
        if (error instanceof ApiProblem && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
  });
}

/** After signing in or out: keep the new session and drop everything cached for the old one. */
export function useSetSession() {
  const client = useQueryClient();
  return (session: StaffMe | null) => {
    client.removeQueries({
      predicate: (query) => query.queryKey[0] !== SESSION_KEY[0],
    });
    client.setQueryData(SESSION_KEY, session);
  };
}

/**
 * Whether the signed-in person holds a permission, as `/me` reports it
 * (ADR-0004). Only for showing or hiding controls: the API decides.
 */
export function useCan(): (permission: Permission) => boolean {
  const session = useSession();
  const held = new Set(session.data?.permissions ?? []);
  return (permission) => held.has(permission);
}
