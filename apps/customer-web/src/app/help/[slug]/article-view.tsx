"use client";

import { ApiProblem } from "@dsd/api-client";
import {
  buttonVariants,
  describeProblem,
  ErrorState,
  format,
  Markdown,
  Skeleton,
} from "@dsd/ui";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

import { PRODUCT_NAME } from "@/components/brand";
import { Container } from "@/components/page";
import { useArticle } from "@/lib/kb";

export function ArticleView({ slug }: { slug: string }) {
  const article = useArticle(slug);

  if (article.isPending) {
    return (
      <Container width="reading" className="py-12">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="mt-6 h-8 w-3/4" />
        <Skeleton className="mt-3 h-5 w-full" />
        <div className="mt-10 space-y-3">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-4 w-full" />
          ))}
        </div>
      </Container>
    );
  }

  if (article.isError) {
    const missing =
      article.error instanceof ApiProblem && article.error.status === 404;
    const message = describeProblem(article.error);
    return (
      <Container width="reading" className="py-16">
        <ErrorState
          title={missing ? "This article isn't available" : message.title}
          description={
            missing
              ? "It may have been moved or taken down. Try searching the help centre."
              : message.description
          }
          requestId={missing ? undefined : message.requestId}
          onRetry={missing ? undefined : () => void article.refetch()}
          action={
            <Link href="/help" className={buttonVariants({ size: "sm" })}>
              Go to the help centre
            </Link>
          }
        />
      </Container>
    );
  }

  const { data } = article;
  return (
    <Container width="reading" className="py-10 sm:py-12">
      <title>{`${data.title} · ${PRODUCT_NAME}`}</title>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/help" className="hover:text-foreground">
              Help centre
            </Link>
          </li>
          {data.category === null ? null : (
            <>
              <ChevronRight aria-hidden="true" className="size-3.5" />
              <li>
                <Link
                  href={`/help?category=${encodeURIComponent(data.category.slug)}`}
                  className="hover:text-foreground"
                >
                  {data.category.name}
                </Link>
              </li>
            </>
          )}
        </ol>
      </nav>
      <article className="mt-6">
        <header className="border-b border-border pb-6">
          <h1 className="text-xl font-semibold text-balance sm:text-2xl">
            {data.title}
          </h1>
          {data.summary === "" ? null : (
            <p className="mt-3 text-md text-muted-foreground">{data.summary}</p>
          )}
          <p className="mt-4 text-sm text-subtle">
            Updated {format.date(data.publishedAt)}
          </p>
        </header>
        <Markdown source={data.bodyMarkdown} className="mt-8" />
      </article>
      <aside className="mt-12 flex flex-col gap-4 rounded-lg border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-semibold">Still need help?</h2>
          <p className="mt-0.5 text-base text-muted-foreground">
            Our team can look into it with you.
          </p>
        </div>
        <Link href="/new" className={buttonVariants({ size: "lg" })}>
          Contact support
        </Link>
      </aside>
    </Container>
  );
}
