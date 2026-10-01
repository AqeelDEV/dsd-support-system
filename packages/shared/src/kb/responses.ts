import { z } from "zod";

import { kbArticleStatusSchema } from "../domain/enums.js";

/*
 * Knowledge-base responses. The public shapes carry published content
 * only: no status, no version, no author, no draft.
 */

const timestamp = z.iso.datetime();

const agentRefSchema = z.object({ id: z.uuid(), displayName: z.string() });

export const kbCategorySchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  slug: z.string(),
  name: z.string(),
  position: z.int(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const kbStaffArticleSummarySchema = z.object({
  id: z.uuid(),
  brandId: z.uuid(),
  category: z
    .object({ id: z.uuid(), slug: z.string(), name: z.string() })
    .nullable(),
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  tags: z.array(z.string()),
  status: kbArticleStatusSchema,
  version: z
    .int()
    .describe("Goes up by one each time the article is published"),
  publishedAt: timestamp.nullable(),
  updatedBy: agentRefSchema,
  updatedAt: timestamp,
});

export const kbStaffArticleSchema = kbStaffArticleSummarySchema.extend({
  bodyMarkdown: z.string().describe("As stored, after sanitising"),
  author: agentRefSchema,
  createdAt: timestamp,
});

const publicCategoryRefSchema = z
  .object({ slug: z.string(), name: z.string() })
  .nullable();

/**
 * A stretch of a search snippet. Matched words have `highlighted` set; the
 * help centre shows them in a `<mark>`. The text is plain, never HTML.
 */
export const snippetSegmentSchema = z.object({
  text: z.string(),
  highlighted: z.boolean(),
});

export const kbPublicArticleSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  category: publicCategoryRefSchema,
  tags: z.array(z.string()),
  publishedAt: timestamp,
  snippet: z
    .array(snippetSegmentSchema)
    .nullable()
    .describe("Where the words matched, when searching; null when browsing"),
});

export const kbPublicArticleSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  bodyMarkdown: z
    .string()
    .describe(
      "Sanitised markdown: render it without raw HTML, as the help centre does",
    ),
  category: publicCategoryRefSchema,
  tags: z.array(z.string()),
  publishedAt: timestamp,
});

export const kbPublicCategorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  articleCount: z.int().describe("Published articles in the category"),
});

export type KbCategory = z.infer<typeof kbCategorySchema>;
export type KbStaffArticleSummary = z.infer<typeof kbStaffArticleSummarySchema>;
export type KbStaffArticle = z.infer<typeof kbStaffArticleSchema>;
export type SnippetSegment = z.infer<typeof snippetSegmentSchema>;
export type KbPublicArticleSummary = z.infer<
  typeof kbPublicArticleSummarySchema
>;
export type KbPublicArticle = z.infer<typeof kbPublicArticleSchema>;
export type KbPublicCategory = z.infer<typeof kbPublicCategorySchema>;
