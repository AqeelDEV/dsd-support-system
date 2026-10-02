"use client";

import { buttonVariants, ErrorState, Panel, Skeleton } from "@dsd/ui";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CreditCard,
  type LucideIcon,
  MessageSquarePlus,
  Search,
  Truck,
  UserRound,
  Wrench,
} from "lucide-react";
import Link from "next/link";

import { ArticleRow, HelpSearch } from "@/components/kb";
import { Container } from "@/components/page";
import { useArticles, useCategories } from "@/lib/kb";
import { isAccount, useSession } from "@/lib/session";

/**
 * An icon for the topics we know; any other topic gets a book. Purely
 * decorative, so a new topic needs no code change.
 */
const TOPIC_ICONS: Record<string, LucideIcon> = {
  "your-account": UserRound,
  "orders-and-billing": CreditCard,
  "delivery-and-returns": Truck,
  troubleshooting: Wrench,
};

export function HomeView() {
  const categories = useCategories();
  const recent = useArticles({ limit: 5 });
  const session = useSession();
  const account = isAccount(session.data);
  const popular = recent.data?.pages[0]?.items.slice(0, 3) ?? [];

  return (
    <>
      <section className="border-b border-border bg-card">
        <Container className="py-14 sm:py-20">
          <div className="max-w-2xl">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">
              How can we help?
            </h1>
            <p className="mt-2 text-muted-foreground">
              Search our guides for your account, orders and devices, or contact
              our support team.
            </p>
            <HelpSearch className="mt-7" />
            {popular.length === 0 ? null : (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
                <span className="text-muted-foreground">Popular:</span>
                {popular.map((article) => (
                  <Link
                    key={article.slug}
                    href={`/help/${article.slug}`}
                    className="rounded-full border border-border bg-background px-3 py-1 text-foreground transition-colors hover:border-border-strong"
                  >
                    {article.title}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Container>
      </section>

      <Container className="py-12 sm:py-14">
        <div className="grid gap-12 lg:grid-cols-[1fr_20rem]">
          <section aria-labelledby="topics-heading">
            <h2 id="topics-heading" className="text-lg font-semibold">
              Browse by topic
            </h2>
            {categories.isPending ? (
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton key={index} className="h-[4.5rem]" />
                ))}
              </div>
            ) : categories.isError ? (
              <Panel className="mt-5">
                <ErrorState
                  title="Topics didn't load"
                  onRetry={() => void categories.refetch()}
                />
              </Panel>
            ) : categories.data.length === 0 ? (
              <p className="mt-5 text-muted-foreground">
                No topics yet. Try searching instead.
              </p>
            ) : (
              <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                {categories.data.map((category) => {
                  const Icon = TOPIC_ICONS[category.slug] ?? BookOpen;
                  return (
                    <li key={category.slug}>
                      <Link
                        href={`/help?category=${encodeURIComponent(category.slug)}`}
                        className="group flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3.5 transition-colors hover:border-border-strong"
                      >
                        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
                          <Icon aria-hidden="true" className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium group-hover:text-primary">
                            {category.name}
                          </span>
                          <span className="block text-sm text-muted-foreground tabular">
                            {category.articleCount}{" "}
                            {category.articleCount === 1
                              ? "article"
                              : "articles"}
                          </span>
                        </span>
                        <ChevronRight
                          aria-hidden="true"
                          className="size-4 text-subtle transition-transform group-hover:translate-x-0.5"
                        />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="mt-12 flex items-baseline justify-between gap-4">
              <h2 className="text-lg font-semibold">Recently updated</h2>
              <Link
                href="/help"
                className="text-base font-medium text-primary hover:underline"
              >
                All articles
              </Link>
            </div>
            <Panel className="mt-4 overflow-hidden">
              {recent.isPending ? (
                <div className="space-y-4 p-5">
                  {Array.from({ length: 3 }, (_, index) => (
                    <Skeleton key={index} className="h-12" />
                  ))}
                </div>
              ) : recent.isError ? (
                <ErrorState
                  title="Articles didn't load"
                  onRetry={() => void recent.refetch()}
                />
              ) : (
                <ul className="divide-y divide-border">
                  {recent.data.pages[0]?.items.map((article) => (
                    <ArticleRow key={article.slug} article={article} />
                  ))}
                </ul>
              )}
            </Panel>
          </section>

          <aside aria-label="Contact support" className="flex flex-col gap-4">
            <Panel className="p-6">
              <span className="grid size-9 place-items-center rounded-md bg-accent text-accent-foreground">
                <MessageSquarePlus aria-hidden="true" className="size-4" />
              </span>
              <h2 className="mt-4 text-md font-semibold">
                Can&apos;t find an answer?
              </h2>
              <p className="mt-1 text-base text-muted-foreground">
                Tell us what&apos;s happening and our team will reply by email.
                You don&apos;t need an account.
              </p>
              <Link
                href="/new"
                className={buttonVariants({
                  variant: "secondary",
                  size: "lg",
                  className: "mt-5 w-full",
                })}
              >
                Contact support
              </Link>
            </Panel>
            <Panel className="p-6">
              <span className="grid size-9 place-items-center rounded-md border border-border bg-muted text-muted-foreground">
                <Search aria-hidden="true" className="size-4" />
              </span>
              <h2 className="mt-4 text-md font-semibold">
                Following up on a request?
              </h2>
              <p className="mt-1 text-base text-muted-foreground">
                {account
                  ? "All your requests and our replies are in one place."
                  : "We'll email you a link to it. Or sign in to see all your requests."}
              </p>
              <Link
                href={account ? "/tickets" : "/find-ticket"}
                className="mt-4 inline-flex items-center gap-1.5 text-base font-medium text-primary hover:underline"
              >
                {account ? "Go to my requests" : "Find my request"}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </Panel>
          </aside>
        </div>
      </Container>
    </>
  );
}
