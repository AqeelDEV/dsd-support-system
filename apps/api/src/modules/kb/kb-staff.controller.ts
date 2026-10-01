import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiNoContentResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  kbArticleCreateRequestSchema,
  kbArticleUpdateRequestSchema,
  kbCategoryCreateRequestSchema,
  kbCategorySchema,
  kbCategoryUpdateRequestSchema,
  kbStaffArticleQuerySchema,
  kbStaffArticleSchema,
  kbStaffArticleSummarySchema,
  pageOf,
} from "@dsd/shared";
import type { FastifyRequest } from "fastify";
import { createZodDto, ZodResponse } from "nestjs-zod";
import { z } from "zod";

import { Realm, RequirePermissions } from "../../auth/decorators.js";
import { staffOf } from "../../auth/request-context.js";
import { ApiProblem, ApiSession } from "../../openapi/decorators.js";
import { KbStaffService } from "./kb-staff.service.js";

class ArticleParams extends createZodDto(
  z.strictObject({ articleId: z.uuid() }),
) {}
class CategoryParams extends createZodDto(
  z.strictObject({ categoryId: z.uuid() }),
) {}
class StaffArticleQuery extends createZodDto(kbStaffArticleQuerySchema) {}
class StaffArticlePage extends createZodDto(
  pageOf(kbStaffArticleSummarySchema),
) {}
class StaffArticle extends createZodDto(kbStaffArticleSchema) {}
class ArticleCreate extends createZodDto(kbArticleCreateRequestSchema) {}
class ArticleUpdate extends createZodDto(kbArticleUpdateRequestSchema) {}
class Category extends createZodDto(kbCategorySchema) {}
class Categories extends createZodDto(z.array(kbCategorySchema)) {}
class CategoryCreate extends createZodDto(kbCategoryCreateRequestSchema) {}
class CategoryUpdate extends createZodDto(kbCategoryUpdateRequestSchema) {}

/**
 * Writing and publishing the knowledge base (FR-15). Reading needs
 * `kb:read`, writing `kb:write`, and publishing, unpublishing and
 * archiving `kb:publish`. Content outside your brands is a 404.
 */
@ApiTags("Knowledge base (staff)")
@Realm("staff")
@Controller("staff/kb")
export class KbStaffController {
  constructor(private readonly kb: KbStaffService) {}

  @Get("articles")
  @RequirePermissions("kb:read")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "List articles",
    description:
      "Every status, drafts included, most recently changed first. Filter by status, category or words.",
  })
  @ApiProblem(400, "A filter or the cursor is invalid")
  @ApiProblem(403, "Missing the `kb:read` permission")
  @ZodResponse({ status: HttpStatus.OK, type: StaffArticlePage })
  articles(@Query() query: StaffArticleQuery, @Req() request: FastifyRequest) {
    return this.kb.articles(staffOf(request), query);
  }

  @Get("articles/:articleId")
  @RequirePermissions("kb:read")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({ summary: "One article, with its markdown" })
  @ApiProblem(403, "Missing the `kb:read` permission")
  @ApiProblem(404, "No such article in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: StaffArticle })
  article(@Param() params: ArticleParams, @Req() request: FastifyRequest) {
    return this.kb.article(staffOf(request), params.articleId);
  }

  @Post("articles")
  @RequirePermissions("kb:write")
  @HttpCode(HttpStatus.CREATED)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Write a draft",
    description:
      "The slug is made from the title unless you give one. Raw HTML and unsafe links are removed from the markdown before it is stored; the response shows what was kept.",
  })
  @ApiProblem(400, "The body is invalid (`validation-error`)")
  @ApiProblem(403, "Missing the `kb:write` permission")
  @ApiProblem(404, "The brand isn't one of yours")
  @ApiProblem(409, "The slug is taken in this brand (`already-exists`)")
  @ApiProblem(422, "The category isn't in this brand")
  @ZodResponse({ status: HttpStatus.CREATED, type: StaffArticle })
  createArticle(@Body() body: ArticleCreate, @Req() request: FastifyRequest) {
    return this.kb.createArticle(staffOf(request), body);
  }

  @Patch("articles/:articleId")
  @RequirePermissions("kb:write")
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Edit an article",
    description:
      "Saving a published article publishes the new text as the next version straight away, so it also needs `kb:publish`. Drafts and archived articles stay as they are.",
  })
  @ApiProblem(400, "The body is invalid (`validation-error`)")
  @ApiProblem(
    403,
    "Missing `kb:write`, or `kb:publish` for a published article",
  )
  @ApiProblem(404, "No such article in your brands")
  @ApiProblem(409, "The slug is taken in this brand (`already-exists`)")
  @ApiProblem(422, "The category isn't in this brand")
  @ZodResponse({ status: HttpStatus.OK, type: StaffArticle })
  updateArticle(
    @Param() params: ArticleParams,
    @Body() body: ArticleUpdate,
    @Req() request: FastifyRequest,
  ) {
    return this.kb.updateArticle(
      staffOf(request),
      params.articleId,
      body,
      request.id,
    );
  }

  @Post("articles/:articleId/publish")
  @RequirePermissions("kb:publish")
  @HttpCode(HttpStatus.OK)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Publish",
    description:
      "Puts a draft or archived article on the help centre as its next version. Already published is a no-op.",
  })
  @ApiProblem(403, "Missing the `kb:publish` permission")
  @ApiProblem(404, "No such article in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: StaffArticle })
  publish(@Param() params: ArticleParams, @Req() request: FastifyRequest) {
    return this.kb.publish(staffOf(request), params.articleId, request.id);
  }

  @Post("articles/:articleId/unpublish")
  @RequirePermissions("kb:publish")
  @HttpCode(HttpStatus.OK)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Unpublish",
    description:
      "Returns the article to draft: off the help centre and out of AI retrieval.",
  })
  @ApiProblem(403, "Missing the `kb:publish` permission")
  @ApiProblem(404, "No such article in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: StaffArticle })
  unpublish(@Param() params: ArticleParams, @Req() request: FastifyRequest) {
    return this.kb.unpublish(staffOf(request), params.articleId, request.id);
  }

  @Post("articles/:articleId/archive")
  @RequirePermissions("kb:publish")
  @HttpCode(HttpStatus.OK)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Archive",
    description:
      "Keeps the article for the record but takes it off the help centre and out of AI retrieval.",
  })
  @ApiProblem(403, "Missing the `kb:publish` permission")
  @ApiProblem(404, "No such article in your brands")
  @ZodResponse({ status: HttpStatus.OK, type: StaffArticle })
  archive(@Param() params: ArticleParams, @Req() request: FastifyRequest) {
    return this.kb.archive(staffOf(request), params.articleId, request.id);
  }

  @Get("categories")
  @RequirePermissions("kb:read")
  @ApiSession("staff", { changesState: false })
  @ApiOperation({
    summary: "List categories",
    description: "In display order.",
  })
  @ApiProblem(403, "Missing the `kb:read` permission")
  @ZodResponse({ status: HttpStatus.OK, type: Categories })
  categories(@Req() request: FastifyRequest) {
    return this.kb.categories(staffOf(request));
  }

  @Post("categories")
  @RequirePermissions("kb:write")
  @HttpCode(HttpStatus.CREATED)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({ summary: "Add a category" })
  @ApiProblem(400, "The body is invalid (`validation-error`)")
  @ApiProblem(403, "Missing the `kb:write` permission")
  @ApiProblem(404, "The brand isn't one of yours")
  @ApiProblem(409, "The slug is taken in this brand (`already-exists`)")
  @ZodResponse({ status: HttpStatus.CREATED, type: Category })
  createCategory(@Body() body: CategoryCreate, @Req() request: FastifyRequest) {
    return this.kb.createCategory(staffOf(request), body);
  }

  @Patch("categories/:categoryId")
  @RequirePermissions("kb:write")
  @ApiSession("staff", { changesState: true })
  @ApiOperation({ summary: "Rename or reorder a category" })
  @ApiProblem(400, "The body is invalid (`validation-error`)")
  @ApiProblem(403, "Missing the `kb:write` permission")
  @ApiProblem(404, "No such category in your brands")
  @ApiProblem(409, "The slug is taken in this brand (`already-exists`)")
  @ZodResponse({ status: HttpStatus.OK, type: Category })
  updateCategory(
    @Param() params: CategoryParams,
    @Body() body: CategoryUpdate,
    @Req() request: FastifyRequest,
  ) {
    return this.kb.updateCategory(staffOf(request), params.categoryId, body);
  }

  @Delete("categories/:categoryId")
  @RequirePermissions("kb:write")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiSession("staff", { changesState: true })
  @ApiOperation({
    summary: "Delete an empty category",
    description: "A category with articles filed under it is a 409.",
  })
  @ApiNoContentResponse({ description: "Deleted" })
  @ApiProblem(403, "Missing the `kb:write` permission")
  @ApiProblem(404, "No such category in your brands")
  @ApiProblem(409, "Articles are filed under it")
  deleteCategory(
    @Param() params: CategoryParams,
    @Req() request: FastifyRequest,
  ) {
    return this.kb.deleteCategory(staffOf(request), params.categoryId);
  }
}
