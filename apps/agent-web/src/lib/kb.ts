"use client";

import { ok } from "@dsd/api-client";
import type { KbArticleStatus } from "@dsd/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api } from "./api";

/** Knowledge-base authoring reads (FR-15). */

export function useStaffArticles(filters: {
  status?: KbArticleStatus;
  q?: string;
}) {
  const q = filters.q?.trim() ?? "";
  return useInfiniteQuery({
    queryKey: ["kb", "articles", filters.status ?? "all", q],
    queryFn: ({ pageParam }) =>
      ok(
        api.GET("/api/v1/staff/kb/articles", {
          params: {
            query: {
              limit: 50,
              ...(filters.status === undefined
                ? {}
                : { status: [filters.status] }),
              ...(q === "" ? {} : { q }),
              ...(pageParam === undefined ? {} : { cursor: pageParam }),
            },
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}

export function useStaffArticle(id: string | undefined) {
  return useQuery({
    queryKey: ["kb", "article", id],
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/kb/articles/{articleId}", {
          params: { path: { articleId: id ?? "" } },
        }),
      ),
    enabled: id !== undefined,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["kb", "categories"],
    queryFn: () => ok(api.GET("/api/v1/staff/kb/categories")),
  });
}
