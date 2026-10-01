import { Controller, Get, HttpStatus, Param, Query } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  kbPublicArticleQuerySchema,
  kbPublicArticleSchema,
  kbPublicArticleSummarySchema,
  kbPublicCategorySchema,
  pageOf,
  SLUG_PATTERN,
} from "@dsd/shared";
import { createZodDto, ZodResponse } from "nestjs-zod";
import { z } from "zod";

import { Public } from "../../auth/decorators.js";
import { ApiProblem } from "../../openapi/decorators.js";
import { KbPublicService } from "./kb-public.service.js";

class PublicArticleQuery extends createZodDto(kbPublicArticleQuerySchema) {}
class PublicArticlePage extends createZodDto(
  pageOf(kbPublicArticleSummarySchema),
) {}
class PublicArticle extends createZodDto(kbPublicArticleSchema) {}
class PublicCategories extends createZodDto(z.array(kbPublicCategorySchema)) {}
class SlugParams extends createZodDto(
  z.strictObject({ slug: z.string().max(100).regex(SLUG_PATTERN) }),
) {}

/** The help centre (FR-4): published articles only, no session needed. */
@ApiTags("Knowledge base (public)")
@Public()
@Controller("public/kb")
export class KbPublicController {
  constructor(private readonly kb: KbPublicService) {}

  @Get("articles")
  @ApiOperation({
    summary: "Browse or search articles",
    description:
      "Without `q`, published articles newest first. With `q`, the best matches first, each with a snippet showing where the words matched. Filter by category slug or tag either way.",
  })
  @ApiProblem(400, "A filter or the cursor is invalid")
  @ZodResponse({ status: HttpStatus.OK, type: PublicArticlePage })
  articles(@Query() query: PublicArticleQuery) {
    return this.kb.articles(query);
  }

  @Get("articles/:slug")
  @ApiOperation({ summary: "Read an article" })
  @ApiProblem(404, "No published article with that slug")
  @ZodResponse({ status: HttpStatus.OK, type: PublicArticle })
  article(@Param() params: SlugParams) {
    return this.kb.article(params.slug);
  }

  @Get("categories")
  @ApiOperation({
    summary: "List categories",
    description: "In display order, with how many published articles each has.",
  })
  @ZodResponse({ status: HttpStatus.OK, type: PublicCategories })
  categories() {
    return this.kb.categories();
  }
}
