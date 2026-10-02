"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import {
  CANNED_VARIABLES,
  type CannedResponse,
  PROBLEM_TYPES,
} from "@dsd/shared";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  EmptyState,
  Field,
  Input,
  Panel,
  ProblemAlert,
  RelativeTime,
  Skeleton,
  Textarea,
  toast,
} from "@dsd/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquareText, Pencil, Plus } from "lucide-react";
import { useDeferredValue, useRef, useState } from "react";

import { LoadError, PageBody, PageHeader } from "@/components/page";
import { api } from "@/lib/api";
import { useCan } from "@/lib/session";

/**
 * Reply templates (FR-12). Everyone with `canned:use` reads them here and
 * inserts them from the composer; writing and retiring them needs
 * `canned:manage`.
 */
export function CannedView() {
  const can = useCan();
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [showRetired, setShowRetired] = useState(false);
  const [editing, setEditing] = useState<CannedResponse | "new">();
  const q = useDeferredValue(query.trim());
  const list = useQuery({
    queryKey: ["canned", "list", q, showRetired],
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/canned-responses", {
          params: {
            query: {
              limit: 100,
              includeRetired: String(showRetired),
              ...(q === "" ? {} : { q }),
            },
          },
        }),
      ),
  });

  const retire = useMutation({
    mutationFn: (id: string) =>
      ok(
        api.POST("/api/v1/staff/canned-responses/{cannedResponseId}/retire", {
          params: { path: { cannedResponseId: id } },
        }),
      ),
    onSuccess: () => {
      toast.success("Retired: it no longer appears in the composer");
      void client.invalidateQueries({ queryKey: ["canned"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const manage = can("canned:manage");

  return (
    <>
      <PageHeader
        title="Canned responses"
        description="Templates agents insert into a reply and edit before sending."
        actions={
          manage ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing("new");
              }}
            >
              <Plus aria-hidden="true" />
              New response
            </Button>
          ) : undefined
        }
      />
      <PageBody className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="canned-filter" className="sr-only">
            Search by title
          </label>
          <Input
            id="canned-filter"
            type="search"
            size="sm"
            className="max-w-xs"
            placeholder="Search by title…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showRetired}
              onChange={(event) => {
                setShowRetired(event.target.checked);
              }}
              className="size-4 accent-[var(--color-primary)]"
            />
            Show retired
          </label>
        </div>
        <Panel className="overflow-hidden" aria-busy={list.isPending}>
          {list.isPending ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : list.isError ? (
            <LoadError
              error={list.error}
              onRetry={() => void list.refetch()}
              what="canned responses"
            />
          ) : list.data.items.length === 0 ? (
            <EmptyState
              icon={MessageSquareText}
              title="No canned responses match"
            />
          ) : (
            <ul className="divide-y divide-border">
              {list.data.items.map((item) => (
                <li key={item.id} className="flex items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {item.title}
                      {item.retiredAt === null ? null : <Badge>Retired</Badge>}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm whitespace-pre-line text-muted-foreground">
                      {item.body}
                    </p>
                    <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {item.variables.map((variable) => (
                        <code
                          key={variable}
                          className="rounded-sm border border-border bg-muted px-1 font-mono text-[0.6875rem]"
                        >
                          {`{{${variable}}}`}
                        </code>
                      ))}
                      <span>
                        Updated <RelativeTime value={item.updatedAt} />
                      </span>
                    </p>
                  </div>
                  {manage && item.retiredAt === null ? (
                    <span className="flex shrink-0 gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Edit ${item.title}`}
                        onClick={() => {
                          setEditing(item);
                        }}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={retire.isPending}
                        onClick={() => {
                          retire.mutate(item.id);
                        }}
                      >
                        Retire
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
        <CannedDialog
          current={editing === "new" ? undefined : editing}
          onClose={() => {
            setEditing(undefined);
          }}
        />
      )}
    </>
  );
}

function CannedDialog({
  current,
  onClose,
}: {
  current: CannedResponse | undefined;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState(current?.title ?? "");
  const [body, setBody] = useState(current?.body ?? "");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const save = useMutation({
    mutationFn: () => {
      const payload = { title: title.trim(), body };
      return current === undefined
        ? ok(api.POST("/api/v1/staff/canned-responses", { body: payload }))
        : ok(
            api.PATCH("/api/v1/staff/canned-responses/{cannedResponseId}", {
              params: { path: { cannedResponseId: current.id } },
              body: payload,
            }),
          );
    },
    onSuccess: () => {
      toast.success("Saved");
      void client.invalidateQueries({ queryKey: ["canned"] });
      onClose();
    },
  });
  const problem = save.error instanceof ApiProblem ? save.error : undefined;

  /** Puts a variable where the cursor is. */
  const insert = (variable: string) => {
    const element = textarea.current;
    const token = `{{${variable}}}`;
    if (element === null) {
      setBody((value) => value + token);
      return;
    }
    const start = element.selectionStart;
    const end = element.selectionEnd;
    setBody((value) => value.slice(0, start) + token + value.slice(end));
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        title={
          current === undefined ? "New canned response" : "Edit canned response"
        }
        className="max-w-xl"
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
          <Field
            label="Title"
            error={
              problem?.type === PROBLEM_TYPES.alreadyExists
                ? "Another active response already has this title."
                : problem?.fieldError("title")
            }
          >
            {(control) => (
              <Input
                {...control}
                size="sm"
                maxLength={100}
                value={title}
                onChange={(event) => {
                  setTitle(event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Text" error={problem?.fieldError("body")}>
            {(control) => (
              <Textarea
                {...control}
                ref={textarea}
                size="sm"
                rows={8}
                maxLength={5000}
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                }}
              />
            )}
          </Field>
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              Insert a variable
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {Object.entries(CANNED_VARIABLES).map(([variable, meaning]) => (
                <button
                  key={variable}
                  type="button"
                  title={meaning}
                  onClick={() => {
                    insert(variable);
                  }}
                  className="rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs hover:border-border-strong"
                >
                  {`{{${variable}}}`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
