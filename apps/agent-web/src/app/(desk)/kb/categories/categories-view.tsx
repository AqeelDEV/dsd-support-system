"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import { type KbCategory, PROBLEM_TYPES } from "@dsd/shared";
import {
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Panel,
  ProblemAlert,
  Skeleton,
  toast,
} from "@dsd/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { LoadError, PageBody, PageHeader } from "@/components/page";
import { api } from "@/lib/api";
import { useCategories } from "@/lib/kb";
import { useCan } from "@/lib/session";

type Editing =
  { kind: "new" } | { kind: "edit"; category: KbCategory } | undefined;

/** Help-centre categories (FR-15): names, addresses and order. */
export function CategoriesView() {
  const can = useCan();
  const client = useQueryClient();
  const categories = useCategories();
  const [editing, setEditing] = useState<Editing>();

  const remove = useMutation({
    mutationFn: (id: string) =>
      ok(
        api.DELETE("/api/v1/staff/kb/categories/{categoryId}", {
          params: { path: { categoryId: id } },
        }),
      ),
    onSuccess: () => {
      toast.success("Category deleted");
      void client.invalidateQueries({ queryKey: ["kb"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiProblem && error.status === 409
          ? "It still has articles. Move them to another category first."
          : error.message,
      );
    },
  });

  return (
    <>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <Link
              href="/kb"
              aria-label="Back to the knowledge base"
              className="text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-4" />
            </Link>
            Categories
          </span>
        }
        description="How the help centre groups its articles, in this order."
        actions={
          can("kb:write") ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing({ kind: "new" });
              }}
            >
              <Plus aria-hidden="true" />
              New category
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        <Panel className="max-w-3xl overflow-hidden">
          {categories.isPending ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-9" />
              <Skeleton className="h-9" />
            </div>
          ) : categories.isError ? (
            <LoadError
              error={categories.error}
              onRetry={() => void categories.refetch()}
              what="the knowledge base"
            />
          ) : categories.data.length === 0 ? (
            <EmptyState icon={FolderTree} title="No categories yet" />
          ) : (
            <ul className="divide-y divide-border">
              {categories.data.map((category) => (
                <li
                  key={category.id}
                  className="flex items-center gap-3 px-4 py-2.5"
                >
                  <span className="w-8 text-right text-xs text-muted-foreground tabular">
                    {category.position}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{category.name}</p>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      /{category.slug}
                    </p>
                  </div>
                  {can("kb:write") ? (
                    <span className="flex gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${category.name}`}
                        onClick={() => {
                          setEditing({ kind: "edit", category });
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${category.name}`}
                        disabled={remove.isPending}
                        onClick={() => {
                          remove.mutate(category.id);
                        }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </PageBody>
      {editing === undefined ? null : (
        <CategoryDialog
          editing={editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </>
  );
}

function CategoryDialog({
  editing,
  onClose,
}: {
  editing: NonNullable<Editing>;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const current = editing.kind === "edit" ? editing.category : undefined;
  const [name, setName] = useState(current?.name ?? "");
  const [slug, setSlug] = useState(current?.slug ?? "");
  const [position, setPosition] = useState(String(current?.position ?? 0));

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        position: Number(position) || 0,
        ...(slug.trim() === "" ? {} : { slug: slug.trim() }),
      };
      return current === undefined
        ? ok(api.POST("/api/v1/staff/kb/categories", { body }))
        : ok(
            api.PATCH("/api/v1/staff/kb/categories/{categoryId}", {
              params: { path: { categoryId: current.id } },
              body,
            }),
          );
    },
    onSuccess: () => {
      toast.success(
        current === undefined ? "Category added" : "Category saved",
      );
      void client.invalidateQueries({ queryKey: ["kb"] });
      onClose();
    },
  });
  const problem = save.error instanceof ApiProblem ? save.error : undefined;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={current === undefined ? "New category" : "Edit category"}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              size="sm"
              pending={save.isPending}
              onClick={() => {
                save.mutate();
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {problem?.errors.length === 0 &&
          problem.type !== PROBLEM_TYPES.alreadyExists ? (
            <ProblemAlert problem={problem} />
          ) : null}
          <Field label="Name" error={problem?.fieldError("name")}>
            {(control) => (
              <Input
                {...control}
                size="sm"
                maxLength={100}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>
          <Field
            label="Address"
            hint="Made from the name when left empty."
            error={
              problem?.type === PROBLEM_TYPES.alreadyExists
                ? "Another category already uses this address."
                : problem?.fieldError("slug")
            }
          >
            {(control) => (
              <Input
                {...control}
                size="sm"
                className="font-mono"
                value={slug}
                onChange={(event) => {
                  setSlug(event.target.value);
                }}
              />
            )}
          </Field>
          <Field
            label="Position"
            hint="Lower numbers come first."
            error={problem?.fieldError("position")}
          >
            {(control) => (
              <Input
                {...control}
                size="sm"
                type="number"
                min={0}
                max={10_000}
                className="w-28"
                value={position}
                onChange={(event) => {
                  setPosition(event.target.value);
                }}
              />
            )}
          </Field>
        </div>
      </DialogContent>
    </Dialog>
  );
}
