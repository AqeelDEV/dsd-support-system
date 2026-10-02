"use client";

import { Skeleton } from "@dsd/ui";

import { LoadError } from "@/components/page";
import { useStaffArticle } from "@/lib/kb";

import { ArticleEditor } from "../article-editor";

export function ArticleView({
  articleId,
  markupRemoved,
}: {
  articleId: string;
  markupRemoved: boolean;
}) {
  const article = useStaffArticle(articleId);
  if (article.isPending) {
    return (
      <div aria-busy="true" className="space-y-4 p-6">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-9" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (article.isError) {
    return (
      <div className="grid flex-1 place-items-center p-6">
        <LoadError
          error={article.error}
          onRetry={() => void article.refetch()}
          what="the knowledge base"
        />
      </div>
    );
  }
  // The editor keeps its own draft and replaces it with what the API stored after each save.
  return (
    <ArticleEditor
      key={article.data.id}
      article={article.data}
      markupRemoved={markupRemoved}
    />
  );
}
