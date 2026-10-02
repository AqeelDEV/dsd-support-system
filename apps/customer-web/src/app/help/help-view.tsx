"use client";

import {
  Button,
  buttonVariants,
  cn,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
} from "@dsd/ui";
import { SearchX } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ArticleRow, HelpSearch } from "@/components/kb";
import { Container } from "@/components/page";
import { useArticles, useCategories } from "@/lib/kb";

export function HelpView() {
  const params = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const categories = useCategories();
  const articles = useArticles({ q, category });
  const items = articles.data?.pages.flatMap((page) => page.items) ?? [];
  const categoryName = categories.data?.find((c) => c.slug === category)?.name;

  const heading =
    q.trim() !== ""
      ? `Results for “${q.trim()}”`
      : (categoryName ?? "All articles");

  const chip = (active: boolean) =>
    cn(
      "inline-flex h-9 shrink-0 items-center rounded-md px-3 text-base transition-colors lg:w-full",
      active
        ? "bg-accent font-medium text-accent-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
    );

  return (
    <>
      <section className="border-b border-border bg-card">
        <Container className="py-10">
          <h1 className="text-xl font-semibold">Help centre</h1>
          <p className="mt-1.5 text-muted-foreground">
            Guides for your account, orders and devices.
          </p>
          <HelpSearch key={q} initial={q} className="mt-6 max-w-2xl" />
        </Container>
      </section>
      <Container className="py-10">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[13rem_1fr]">
          <nav aria-label="Topics" className="min-w-0">
            <h2 className="mb-2 hidden text-xs font-medium text-muted-foreground lg:block">
              Topics
            </h2>
            <ul className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:px-0">
              <li>
                <Link
                  href={q === "" ? "/help" : `/help?q=${encodeURIComponent(q)}`}
                  className={chip(category === "")}
                  aria-current={category === "" ? "page" : undefined}
                >
                  All topics
                </Link>
              </li>
              {categories.isPending
                ? Array.from({ length: 4 }, (_, index) => (
                    <li key={index}>
                      <Skeleton className="h-9 w-28 lg:w-full" />
                    </li>
                  ))
                : (categories.data ?? []).map((c) => {
                    const search = new URLSearchParams({
                      ...(q === "" ? {} : { q }),
                      category: c.slug,
                    });
                    return (
                      <li key={c.slug}>
                        <Link
                          href={`/help?${search.toString()}`}
                          className={chip(category === c.slug)}
                          aria-current={
                            category === c.slug ? "page" : undefined
                          }
                        >
                          <span className="truncate">{c.name}</span>
                          <span className="ml-auto pl-3 text-xs text-subtle tabular">
                            {c.articleCount}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
            </ul>
          </nav>

          <section
            aria-labelledby="results-heading"
            aria-busy={articles.isPending}
            className="min-w-0"
          >
            <h2 id="results-heading" className="text-lg font-semibold">
              {heading}
            </h2>
            <Panel className="mt-4 overflow-hidden">
              {articles.isPending ? (
                <div className="space-y-5 p-5">
                  {Array.from({ length: 4 }, (_, index) => (
                    <div key={index} className="space-y-2">
                      <Skeleton className="h-4 w-1/2" />
                      <Skeleton className="h-4 w-5/6" />
                    </div>
                  ))}
                </div>
              ) : articles.isError ? (
                <ErrorState
                  title="Articles didn't load"
                  onRetry={() => void articles.refetch()}
                />
              ) : items.length === 0 ? (
                <EmptyState
                  icon={SearchX}
                  title="No articles match"
                  description={
                    q === ""
                      ? "There are no articles in this topic yet."
                      : "Try fewer or different words, or ask our team directly."
                  }
                  action={
                    <Link
                      href="/new"
                      className={buttonVariants({ variant: "secondary" })}
                    >
                      Contact support
                    </Link>
                  }
                />
              ) : (
                <ul className="divide-y divide-border">
                  {items.map((article) => (
                    <ArticleRow key={article.slug} article={article} />
                  ))}
                </ul>
              )}
            </Panel>
            {articles.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="secondary"
                  pending={articles.isFetchingNextPage}
                  onClick={() => void articles.fetchNextPage()}
                >
                  Show more articles
                </Button>
              </div>
            ) : null}
          </section>
        </div>
      </Container>
    </>
  );
}
