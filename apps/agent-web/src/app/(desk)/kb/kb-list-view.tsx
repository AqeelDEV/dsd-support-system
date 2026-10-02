"use client";

import { KB_ARTICLE_STATUSES, type KbArticleStatus } from "@dsd/shared";
import {
  ArticleStatusBadge,
  Button,
  buttonVariants,
  cn,
  EmptyState,
  Input,
  Panel,
  RelativeTime,
  Skeleton,
} from "@dsd/ui";
import { BookOpen, FolderTree, Plus, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDeferredValue, useState } from "react";

import { LoadError, PageBody, PageHeader } from "@/components/page";
import { useStaffArticles } from "@/lib/kb";
import { useCan } from "@/lib/session";

const TABS: { status: KbArticleStatus | undefined; label: string }[] = [
  { status: undefined, label: "All" },
  { status: "draft", label: "Drafts" },
  { status: "published", label: "Published" },
  { status: "archived", label: "Archived" },
];

export function KbListView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const can = useCan();
  const raw = params.get("status");
  const status = KB_ARTICLE_STATUSES.find((value) => value === raw);
  const [query, setQuery] = useState(params.get("q") ?? "");
  const q = useDeferredValue(query);
  const articles = useStaffArticles({ status, q });
  const items = articles.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader
        title="Knowledge base"
        description="Articles customers find in the help centre."
        actions={
          <>
            <Link
              href="/kb/categories"
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <FolderTree aria-hidden="true" />
              Categories
            </Link>
            {can("kb:write") ? (
              <Link href="/kb/new" className={buttonVariants({ size: "sm" })}>
                <Plus aria-hidden="true" />
                New article
              </Link>
            ) : null}
          </>
        }
      >
        <nav
          aria-label="Article status"
          className="-mb-px flex gap-4 overflow-x-auto"
        >
          {TABS.map((tab) => {
            const current = tab.status === status;
            return (
              <Link
                key={tab.label}
                href={
                  tab.status === undefined ? "/kb" : `/kb?status=${tab.status}`
                }
                aria-current={current ? "page" : undefined}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center border-b-2 text-sm font-medium",
                  current
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </PageHeader>
      <PageBody className="flex flex-col gap-3">
        <form
          role="search"
          className="relative max-w-sm"
          onSubmit={(event) => {
            event.preventDefault();
            const next = new URLSearchParams(params);
            if (query.trim() === "") next.delete("q");
            else next.set("q", query.trim());
            router.replace(`${pathname}?${next.toString()}`);
          }}
        >
          <label htmlFor="kb-search" className="sr-only">
            Search articles
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-subtle"
          />
          <Input
            id="kb-search"
            type="search"
            size="sm"
            className="pl-8"
            placeholder="Search titles and text…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </form>
        <Panel className="overflow-hidden" aria-busy={articles.isPending}>
          {articles.isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-9" />
              ))}
            </div>
          ) : articles.isError ? (
            <LoadError
              error={articles.error}
              onRetry={() => void articles.refetch()}
              what="the knowledge base"
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={BookOpen}
              title={
                q.trim() === "" ? "No articles here yet" : "No articles match"
              }
              description={
                can("kb:write") ? "Write one for the help centre." : undefined
              }
            />
          ) : (
            <table className="w-full table-fixed border-collapse text-sm">
              <thead className="bg-card">
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pl-4 font-medium">
                    Title
                  </th>
                  <th
                    scope="col"
                    className="hidden w-44 py-2 font-medium md:table-cell"
                  >
                    Category
                  </th>
                  <th scope="col" className="w-28 py-2 font-medium">
                    Status
                  </th>
                  <th
                    scope="col"
                    className="hidden w-16 py-2 font-medium sm:table-cell"
                  >
                    Version
                  </th>
                  <th
                    scope="col"
                    className="hidden w-48 py-2 pr-4 font-medium lg:table-cell"
                  >
                    Updated
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((article) => (
                  <tr
                    key={article.id}
                    className="relative border-b border-border last:border-b-0 hover:bg-muted/60"
                  >
                    <td className="py-2 pr-3 pl-4">
                      <Link
                        href={`/kb/${article.id}`}
                        className="block truncate font-medium after:absolute after:inset-0"
                      >
                        {article.title}
                      </Link>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        /{article.slug}
                      </span>
                    </td>
                    <td className="hidden truncate text-muted-foreground md:table-cell">
                      {article.category?.name ?? "No category"}
                    </td>
                    <td>
                      <ArticleStatusBadge status={article.status} />
                    </td>
                    <td className="hidden text-muted-foreground tabular sm:table-cell">
                      {article.version === 0 ? "–" : `v${article.version}`}
                    </td>
                    <td className="hidden truncate pr-4 text-muted-foreground lg:table-cell">
                      <RelativeTime value={article.updatedAt} /> by{" "}
                      {article.updatedBy.displayName}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        {articles.hasNextPage ? (
          <div className="flex justify-center">
            <Button
              variant="secondary"
              size="sm"
              pending={articles.isFetchingNextPage}
              onClick={() => void articles.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        ) : null}
      </PageBody>
    </>
  );
}
