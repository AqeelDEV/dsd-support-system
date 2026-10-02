import type { Metadata } from "next";

import { ArticleEditor } from "../article-editor";

export const metadata: Metadata = { title: "New article" };

export default function NewArticlePage() {
  return <ArticleEditor />;
}
