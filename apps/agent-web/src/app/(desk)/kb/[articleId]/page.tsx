import { ArticleView } from "./article-view";

export default async function ArticlePage({
  params,
  searchParams,
}: {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<{ markup?: string }>;
}) {
  const { articleId } = await params;
  const { markup } = await searchParams;
  return (
    <ArticleView articleId={articleId} markupRemoved={markup === "removed"} />
  );
}
