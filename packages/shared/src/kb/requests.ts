import { z } from "zod";

import { kbArticleStatusSchema } from "../domain/enums.js";
import { pageFields, repeatable, text } from "../http/fields.js";

/*
 * Knowledge-base requests (FR-4, FR-15). Article bodies are markdown; the
 * API sanitises them on save, so what comes back is what is stored.
 */

/** Lowercase words joined by hyphens: the article's stable public URL. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const slug = z
  .string()
  .max(100)
  .regex(SLUG_PATTERN, "must be lowercase words joined by hyphens")
  .describe("Lowercase words joined by hyphens, like `reset-your-router`");

const tag = z
  .string()
  .max(40)
  .regex(SLUG_PATTERN, "must be lowercase words joined by hyphens");

const brandId = z
  .uuid()
  .optional()
  .describe("Your brand; required only if you belong to more than one");

/** At least one field, so an empty PATCH is a 400 rather than a silent no-op. */
const someField = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z
    .strictObject(shape)
    .refine((value) => Object.values(value).some((v) => v !== undefined), {
      message: "Send at least one field to change",
    });

export const kbCategoryCreateRequestSchema = z.strictObject({
  brandId,
  name: text(100),
  slug: slug.optional().describe("Made from the name when left out"),
  position: z.int().min(0).max(10_000).default(0),
});

export const kbCategoryUpdateRequestSchema = someField({
  name: text(100).optional(),
  slug: slug.optional(),
  position: z.int().min(0).max(10_000).optional(),
});

const articleFields = {
  categoryId: z.uuid().nullable().optional(),
  title: text(200),
  summary: z
    .string()
    .trim()
    .max(500)
    .describe("One or two sentences for search results"),
  bodyMarkdown: text(100_000).describe(
    "Markdown. Raw HTML and links that aren't http, https, mailto or relative are removed when it is saved.",
  ),
  tags: z.array(tag).max(20),
};

export const kbArticleCreateRequestSchema = z.strictObject({
  brandId,
  slug: slug.optional().describe("Made from the title when left out"),
  categoryId: articleFields.categoryId,
  title: articleFields.title,
  summary: articleFields.summary.default(""),
  bodyMarkdown: articleFields.bodyMarkdown,
  tags: articleFields.tags.default([]),
});

export const kbArticleUpdateRequestSchema = someField({
  slug: slug.optional(),
  categoryId: articleFields.categoryId,
  title: articleFields.title.optional(),
  summary: articleFields.summary.optional(),
  bodyMarkdown: articleFields.bodyMarkdown.optional(),
  tags: articleFields.tags.optional(),
});

export const kbStaffArticleQuerySchema = z.strictObject({
  status: repeatable(kbArticleStatusSchema).describe(
    "One or more statuses; all by default",
  ),
  categoryId: z.uuid().optional(),
  q: text(200).optional().describe("Words to look for"),
  ...pageFields,
});

export const kbPublicArticleQuerySchema = z.strictObject({
  q: text(200)
    .optional()
    .describe(
      'Words to look for. "Quoted phrases", `or`, and `-word` to exclude are understood.',
    ),
  category: slug.optional().describe("A category's slug"),
  tag: tag.optional(),
  ...pageFields,
});

export type KbCategoryCreateRequest = z.infer<
  typeof kbCategoryCreateRequestSchema
>;
export type KbCategoryUpdateRequest = z.infer<
  typeof kbCategoryUpdateRequestSchema
>;
export type KbArticleCreateRequest = z.infer<
  typeof kbArticleCreateRequestSchema
>;
export type KbArticleUpdateRequest = z.infer<
  typeof kbArticleUpdateRequestSchema
>;
export type KbStaffArticleQuery = z.infer<typeof kbStaffArticleQuerySchema>;
export type KbPublicArticleQuery = z.infer<typeof kbPublicArticleQuerySchema>;
