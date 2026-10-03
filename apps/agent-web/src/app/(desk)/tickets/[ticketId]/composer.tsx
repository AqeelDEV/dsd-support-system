"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import type { StaffTicket, TicketStatus } from "@dsd/shared";
import {
  AttachmentPicker,
  Button,
  cn,
  Input,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ProblemAlert,
  Select,
  Spinner,
  STATUS_LABELS,
  Textarea,
  toast,
} from "@dsd/ui";
import { useQuery } from "@tanstack/react-query";
import { Lock, MessageSquareText, Send, Sparkles, X } from "lucide-react";
import {
  type Ref,
  useDeferredValue,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import { isTyping } from "@/components/shortcuts";
import { api } from "@/lib/api";
import { useCan } from "@/lib/session";
import { useTicketActions } from "@/lib/tickets";

type Mode = "reply" | "note";

/** What the AI suggestion panel can do to the composer: only fill it. */
export interface ComposerHandle {
  insertSuggestion: (draft: string, suggestionId: string) => void;
}

/**
 * Reply to the customer or leave an internal note (FR-8, FR-10). What can
 * be sent and which statuses a reply may set come from the ticket's
 * `allowedActions` and `allowedTransitions`; the API checks them again.
 *
 * A draft inserted from the AI panel becomes ordinary text the agent edits;
 * the reply then names the suggestion it was based on, so the API records
 * the agent as its approver (ADR-0006, section 8). The agent can drop that
 * link, and only ever sends what is in the box.
 */
export function Composer({
  ticket,
  ref,
}: {
  ticket: StaffTicket;
  ref?: Ref<ComposerHandle>;
}) {
  const can = useCan();
  const actions = useTicketActions(ticket.id);
  const modes: Mode[] = [
    ...(ticket.allowedActions.reply ? (["reply"] as const) : []),
    ...(ticket.allowedActions.addNote ? (["note"] as const) : []),
  ];
  const [mode, setMode] = useState<Mode>(modes[0] ?? "note");
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [nextStatus, setNextStatus] = useState<TicketStatus | "">("");
  const [basedOn, setBasedOn] = useState<string>();
  const [error, setError] = useState<string>();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const statusId = useId();

  const active = modes.includes(mode) ? mode : modes[0];
  const sending = actions.reply.isPending || actions.note.isPending;
  const failure = active === "note" ? actions.note.error : actions.reply.error;

  // r opens a reply, n a note, from anywhere on the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        isTyping(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const wanted =
        event.key === "r" ? "reply" : event.key === "n" ? "note" : undefined;
      if (wanted === undefined || !modes.includes(wanted)) return;
      event.preventDefault();
      setMode(wanted);
      textarea.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  });

  const insert = (text: string) => {
    setBody((current) =>
      current.trim() === "" ? text : `${current.trimEnd()}\n\n${text}`,
    );
    textarea.current?.focus();
  };

  useImperativeHandle(ref, () => ({
    insertSuggestion: (draft, suggestionId) => {
      if (!modes.includes("reply")) return;
      setMode("reply");
      setBasedOn(suggestionId);
      insert(draft);
    },
  }));

  if (active === undefined) return null;

  const send = () => {
    const text = body.trim();
    if (text === "") {
      setError(
        active === "note" ? "Write the note first." : "Write a reply first.",
      );
      return;
    }
    setError(undefined);
    const done = () => {
      setBody("");
      setFiles([]);
      setNextStatus("");
      if (active === "reply") setBasedOn(undefined);
      toast.success(active === "note" ? "Note added" : "Reply sent");
    };
    if (active === "note") {
      actions.note.mutate({ body: text, files }, { onSuccess: done });
    } else {
      actions.reply.mutate(
        {
          body: text,
          files,
          ...(nextStatus === "" ? {} : { status: nextStatus }),
          ...(basedOn === undefined ? {} : { aiSuggestionId: basedOn }),
        },
        { onSuccess: done },
      );
    }
  };

  return (
    <section
      aria-label="Reply or add a note"
      className={cn(
        "rounded-lg border bg-card transition-colors",
        active === "note"
          ? "border-note-border"
          : "border-border focus-within:border-border-strong",
      )}
    >
      <div
        className="flex items-center gap-1 border-b border-border px-2 pt-1.5"
        role="tablist"
      >
        {modes.map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={active === item}
            onClick={() => {
              setMode(item);
              textarea.current?.focus();
            }}
            className={cn(
              "-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 px-2 text-sm font-medium",
              active === item
                ? item === "note"
                  ? "border-tone-warning text-foreground"
                  : "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item === "note" ? (
              <Lock aria-hidden="true" className="size-3.5" />
            ) : null}
            {item === "reply" ? "Reply" : "Internal note"}
            <Kbd className="ml-1 hidden sm:inline-flex">
              {item === "reply" ? "r" : "n"}
            </Kbd>
          </button>
        ))}
      </div>
      <form
        noValidate
        className="flex flex-col gap-2 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <label htmlFor={`composer-${ticket.id}`} className="sr-only">
          {active === "note" ? "Internal note" : "Reply to the customer"}
        </label>
        <Textarea
          id={`composer-${ticket.id}`}
          ref={textarea}
          size="sm"
          rows={5}
          maxLength={20_000}
          value={body}
          aria-invalid={error === undefined ? undefined : true}
          placeholder={
            active === "note"
              ? "Only staff can see notes. Share context, ask a colleague…"
              : `Reply to ${ticket.customer.displayName ?? ticket.customer.email}…`
          }
          className={cn(active === "note" && "bg-note text-note-foreground")}
          onChange={(event) => {
            setBody(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              send();
            }
            if (event.key === "Escape") event.currentTarget.blur();
          }}
        />
        {active === "reply" && basedOn !== undefined ? (
          <p className="flex items-center gap-2 self-start rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-xs text-muted-foreground">
            <Sparkles aria-hidden="true" className="size-3.5 text-primary" />
            Based on an AI suggestion. You&apos;re sending it as your reply.
            <button
              type="button"
              aria-label="Don't link this reply to the AI suggestion"
              className="grid size-5 place-items-center rounded-full hover:bg-background hover:text-foreground"
              onClick={() => {
                setBasedOn(undefined);
              }}
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </p>
        ) : null}
        {error === undefined ? null : (
          <p role="alert" className="text-xs font-medium text-tone-danger-fg">
            {error}
          </p>
        )}
        {failure instanceof ApiProblem && failure.status !== 400 ? (
          <ProblemAlert problem={failure} />
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <AttachmentPicker
            files={files}
            onChange={setFiles}
            compact
            disabled={sending}
          />
          {active === "reply" && can("canned:use") ? (
            <CannedPicker ticketId={ticket.id} onInsert={insert} />
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            {active === "reply" && ticket.allowedTransitions.length > 0 ? (
              <>
                <label
                  htmlFor={statusId}
                  className="text-xs text-muted-foreground"
                >
                  Then
                </label>
                <Select
                  id={statusId}
                  size="sm"
                  className="w-44"
                  value={nextStatus}
                  onChange={(event) => {
                    setNextStatus(event.target.value as TicketStatus | "");
                  }}
                >
                  <option value="">Keep {STATUS_LABELS[ticket.status]}</option>
                  {ticket.allowedTransitions.map((status) => (
                    <option key={status} value={status}>
                      Set {STATUS_LABELS[status]}
                    </option>
                  ))}
                </Select>
              </>
            ) : null}
            <Button
              type="submit"
              size="sm"
              pending={sending}
              className={cn(
                active === "note" &&
                  "bg-foreground text-background hover:bg-foreground/90",
              )}
            >
              {sending ? null : <Send aria-hidden="true" />}
              {active === "note" ? "Add note" : "Send"}
              <Kbd className="hidden border-transparent bg-white/15 text-current shadow-none sm:inline-flex">
                Ctrl ↵
              </Kbd>
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

/** Canned responses (FR-12): filled in for this ticket by the API, inserted for the agent to edit before sending. */
function CannedPicker({
  ticketId,
  onInsert,
}: {
  ticketId: string;
  onInsert: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const q = useDeferredValue(query.trim());
  const [rendering, setRendering] = useState<string>();
  const list = useQuery({
    queryKey: ["canned", "picker", q],
    queryFn: () =>
      ok(
        api.GET("/api/v1/staff/canned-responses", {
          params: { query: { limit: 20, ...(q === "" ? {} : { q }) } },
        }),
      ),
    enabled: open,
  });

  const pick = async (id: string) => {
    setRendering(id);
    try {
      const rendered = await ok(
        api.GET("/api/v1/staff/canned-responses/{cannedResponseId}/render", {
          params: { path: { cannedResponseId: id }, query: { ticketId } },
        }),
      );
      onInsert(rendered.body);
      setOpen(false);
      setQuery("");
    } catch (error) {
      toast.error(
        error instanceof ApiProblem
          ? error.message
          : "That response couldn't be filled in.",
      );
    } finally {
      setRendering(undefined);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <MessageSquareText aria-hidden="true" />
          Canned response
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="border-b border-border p-2">
          <label htmlFor="canned-search" className="sr-only">
            Search canned responses
          </label>
          <Input
            id="canned-search"
            size="sm"
            placeholder="Search by title…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />
        </div>
        <ul
          className="max-h-72 overflow-y-auto p-1"
          aria-label="Canned responses"
        >
          {list.isPending ? (
            <li className="flex justify-center p-4 text-muted-foreground">
              <Spinner />
            </li>
          ) : list.isError ? (
            <li className="p-3 text-sm text-muted-foreground">
              They didn&apos;t load. Try again.
            </li>
          ) : list.data.items.length === 0 ? (
            <li className="p-3 text-sm text-muted-foreground">
              No canned responses match.
            </li>
          ) : (
            list.data.items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  disabled={rendering !== undefined}
                  onClick={() => void pick(item.id)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-muted disabled:opacity-60"
                >
                  <span className="flex w-full items-center gap-2 text-sm font-medium">
                    {item.title}
                    {rendering === item.id ? (
                      <Spinner className="ml-auto size-3.5" />
                    ) : null}
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {item.body}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
