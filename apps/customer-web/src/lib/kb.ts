"use client";

import { ok } from "@dsd/api-client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api } from "./api";

/** The help centre's reads (FR-4). Everything here is public: no session needed. */

export function useCategories() {
  return useQuery({
    queryKey: ["kb", "categories"],
    queryFn: () => ok(api.GET("/api/v1/public/kb/categories")),
    staleTime: 5 * 60_000,
  });
}

export function useArticles(filters: {
  q?: string;
  category?: string;
  limit?: number;
  enabled?: boolean;
}) {
  const q = blankToUndefined(filters.q?.trim());
  const category = blankToUndefined(filters.category);
  return useInfiniteQuery({
    queryKey: ["kb", "articles", { q, category, limit: filters.limit }],
    queryFn: ({ pageParam }) =>
      ok(
        api.GET("/api/v1/public/kb/articles", {
          params: {
            query: {
              ...(q === undefined ? {} : { q }),
              ...(category === undefined ? {} : { category }),
              limit: filters.limit ?? 10,
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 60_000,
    enabled: filters.enabled ?? true,
  });
}

const blankToUndefined = (value: string | undefined) =>
  value === undefined || value === "" ? undefined : value;

export function useArticle(slug: string) {
  return useQuery({
    queryKey: ["kb", "article", slug],
    queryFn: () =>
      ok(
        api.GET("/api/v1/public/kb/articles/{slug}", {
          params: { path: { slug } },
        }),
      ),
    staleTime: 60_000,
  });
}
