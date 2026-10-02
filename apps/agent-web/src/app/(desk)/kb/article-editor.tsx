"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import { type KbStaffArticle, PROBLEM_TYPES } from "@dsd/shared";
import {
  Alert,
  ArticleStatusBadge,
  Button,
  cn,
  Field,
  Input,
  Markdown,
  ProblemAlert,
  RelativeTime,
  Select,
  Textarea,
  toast,
} from "@dsd/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, PencilLine } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";
import { useCategories } from "@/lib/kb";
import { useCan } from "@/lib/session";

interface Draft {
  title: string;
  slug: string;
  summary: string;
  categoryId: string;
  tags: string;
  bodyMarkdown: string;
}

const fromArticle = (article: KbStaffArticle | undefined): Draft => ({
  title: article?.title ?? "",
  slug: article?.slug ?? "",
  summary: article?.summary ?? "",
  categoryId: article?.category?.id ?? "",
  tags: article?.tags.join(", ") ?? "",
  bodyMarkdown: article?.bodyMarkdown ?? "",
});

const tagsOf = (text: string) =>
  text
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter((tag) => tag !== "");

/**
 * Writing and publishing an article (FR-15; ADR-0012). The preview uses the
 * same renderer as the help centre. The API sanitises the markdown when it
 * saves, and returns what it stored: if that differs from what was typed,
 * the editor says so and shows the stored text.
 */
export function ArticleEditor({ article }: { article?: KbStaffArticle }) {
  const can = useCan();
  const router = useRouter();
  const client = useQueryClient();
  const categories = useCategories();
  const [draft, setDraft] = useState<Draft>(() => fromArticle(article));
  const [view, setView] = useState<"write" | "preview">("write");
  const [stripped, setStripped] = useState(false);
  const editable =
    can("kb:write") && (article?.status !== "published" || can("kb:publish"));

  const set = (field: keyof Draft) => (value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const saved = (stored: KbStaffArticle, sent: string) => {
    setStripped(stored.bodyMarkdown !== sent.trim());
    setDraft(fromArticle(stored));
    client.setQueryData(["kb", "article", stored.id], stored);
    void client.invalidateQueries({ queryKey: ["kb", "articles"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        title: draft.title.trim(),
        summary: draft.summary.trim(),
        bodyMarkdown: draft.bodyMarkdown,
        tags: tagsOf(draft.tags),
        categoryId: draft.categoryId === "" ? null : draft.categoryId,
        ...(draft.slug.trim() === "" ? {} : { slug: draft.slug.trim() }),
      };
      return article === undefined
        ? ok(api.POST("/api/v1/staff/kb/articles", { body }))
        : ok(
            api.PATCH("/api/v1/staff/kb/articles/{articleId}", {
              params: { path: { articleId: article.id } },
              body,
            }),
          );
    },
    onSuccess: (stored) => {
      saved(stored, draft.bodyMarkdown);
      toast.success(
        stored.status === "published"
          ? `Saved and published as version ${stored.version}`
          : "Draft saved",
      );
      if (article === undefined) router.replace(`/kb/${stored.id}`);
    },
  });

  const lifecycle = useMutation({
    mutationFn: (action: "publish" | "unpublish" | "archive") => {
      const id = article?.id ?? "";
      const options = { params: { path: { articleId: id } } };
      switch (action) {
        case "publish":
          return ok(
            api.POST("/api/v1/staff/kb/articles/{articleId}/publish", options),
          );
        case "unpublish":
          return ok(
            api.POST(
              "/api/v1/staff/kb/articles/{articleId}/unpublish",
              options,
            ),
          );
        case "archive":
          return ok(
            api.POST("/api/v1/staff/kb/articles/{articleId}/archive", options),
          );
      }
    },
    onSuccess: (stored, action) => {
      saved(stored, stored.bodyMarkdown);
      toast.success(
        action === "publish"
          ? `Published as version ${stored.version}`
          : action === "unpublish"
            ? "Moved back to drafts"
            : "Archived",
      );
    },
  });

  const problem = save.error instanceof ApiProblem ? save.error : undefined;
  const slugTaken = problem?.type === PROBLEM_TYPES.alreadyExists;

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-2.5 sm:px-6">
        <Link
          href="/kb"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          Knowledge base
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
          {article === undefined ? "New article" : article.title}
        </h1>
        {article === undefined ? null : (
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <ArticleStatusBadge status={article.status} />
            {article.version === 0 ? null : (
              <span className="tabular">v{article.version}</span>
            )}
            <span className="hidden sm:inline">
              Saved <RelativeTime value={article.updatedAt} /> by{" "}
              {article.updatedBy.displayName}
            </span>
          </span>
        )}
        <div className="flex gap-2">
          {article !== undefined && can("kb:publish") ? (
            <>
              {article.status === "published" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={
                    lifecycle.isPending && lifecycle.variables === "unpublish"
                  }
                  onClick={() => {
                    lifecycle.mutate("unpublish");
                  }}
                >
                  Unpublish
                </Button>
              ) : null}
              {article.status === "archived" ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={
                    lifecycle.isPending && lifecycle.variables === "archive"
                  }
                  onClick={() => {
                    lifecycle.mutate("archive");
                  }}
                >
                  Archive
                </Button>
              )}
              {article.status === "published" ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  pending={
                    lifecycle.isPending && lifecycle.variables === "publish"
                  }
                  onClick={() => {
                    lifecycle.mutate("publish");
                  }}
                >
                  Publish
                </Button>
              )}
            </>
          ) : null}
          {editable ? (
            <Button
              size="sm"
              pending={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              {article?.status === "published"
                ? "Save and republish"
                : "Save draft"}
            </Button>
          ) : null}
        </div>
      </header>

      <div className="flex flex-col gap-3 px-4 pt-4 sm:px-6">
        {stripped ? (
          <Alert tone="warning" title="Some markup was removed when saving">
            Raw HTML and links with unsafe addresses aren&apos;t allowed. The
            text below is what was stored.
          </Alert>
        ) : null}
        {problem !== undefined && !slugTaken ? (
          <ProblemAlert problem={problem} />
        ) : null}
        <ProblemAlert problem={lifecycle.error} />
        {editable ? null : (
          <Alert tone="info">
            {can("kb:write")
              ? "Editing a published article republishes it, which needs the publish permission."
              : "You can read articles here. Writing them needs a supervisor or an admin."}
          </Alert>
        )}
      </div>

      <fieldset
        disabled={!editable}
        className="grid flex-1 gap-4 p-4 sm:p-6 xl:grid-cols-2"
      >
        <legend className="sr-only">Article</legend>
        <div className="flex min-w-0 flex-col gap-4">
          <Field label="Title" error={problem?.fieldError("title")}>
            {(control) => (
              <Input
                {...control}
                maxLength={200}
                value={draft.title}
                onChange={(event) => {
                  set("title")(event.target.value);
                }}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Address"
              hint="Made from the title when left empty."
              error={
                slugTaken
                  ? "Another article already uses this address."
                  : problem?.fieldError("slug")
              }
            >
              {(control) => (
                <Input
                  {...control}
                  className="font-mono"
                  placeholder="reset-your-hub"
                  value={draft.slug}
                  onChange={(event) => {
                    set("slug")(event.target.value);
                  }}
                />
              )}
            </Field>
            <Field
              label="Category"
              error={problem?.status === 422 ? problem.message : undefined}
            >
              {(control) => (
                <Select
                  {...control}
                  value={draft.categoryId}
                  onChange={(event) => {
                    set("categoryId")(event.target.value);
                  }}
                >
                  <option value="">No category</option>
                  {(categories.data ?? []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Field
            label="Summary"
            hint="One or two sentences, shown in search results."
            error={problem?.fieldError("summary")}
          >
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={500}
                className="min-h-0"
                value={draft.summary}
                onChange={(event) => {
                  set("summary")(event.target.value);
                }}
              />
            )}
          </Field>
          <Field
            label="Tags"
            hint="Separated by commas."
            error={problem?.fieldError("tags")}
          >
            {(control) => (
              <Input
                {...control}
                value={draft.tags}
                onChange={(event) => {
                  set("tags")(event.target.value);
                }}
              />
            )}
          </Field>
          <div
            className="flex items-center gap-1 xl:hidden"
            role="tablist"
            aria-label="Body"
          >
            {(["write", "preview"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={view === mode}
                onClick={() => {
                  setView(mode);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm",
                  view === mode
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground",
                )}
              >
                {mode === "write" ? (
                  <PencilLine aria-hidden="true" className="size-4" />
                ) : (
                  <Eye aria-hidden="true" className="size-4" />
                )}
                {mode === "write" ? "Write" : "Preview"}
              </button>
            ))}
          </div>
          <div
            className={cn("flex-1", view === "preview" && "hidden xl:block")}
          >
            <Field
              label="Body (markdown)"
              error={problem?.fieldError("bodyMarkdown")}
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={18}
                  maxLength={100_000}
                  className="font-mono text-sm leading-6"
                  value={draft.bodyMarkdown}
                  onChange={(event) => {
                    set("bodyMarkdown")(event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
        </div>
        <section
          aria-label="Preview"
          className={cn(
            "min-w-0 rounded-lg border border-border bg-card px-6 py-5",
            view === "write" && "hidden xl:block",
          )}
        >
          <p className="mb-4 text-xs font-medium text-muted-foreground">
            Preview, as the help centre shows it
          </p>
          <h2 className="text-xl font-semibold">
            {draft.title === "" ? "Untitled" : draft.title}
          </h2>
          {draft.summary === "" ? null : (
            <p className="mt-2 text-muted-foreground">{draft.summary}</p>
          )}
          <Markdown
            source={draft.bodyMarkdown}
            className="mt-6 text-sm leading-6"
          />
        </section>
      </fieldset>
    </div>
  );
}
