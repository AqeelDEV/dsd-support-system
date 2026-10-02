import { ArticleView } from "./article-view";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ articleId: string }>;
}) {
  const { articleId } = await params;
  return <ArticleView articleId={articleId} />;
}
