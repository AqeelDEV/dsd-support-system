"use client";

import { ApiProblem } from "@dsd/api-client";
import type { CustomerTicket, TicketStatus } from "@dsd/shared";
import {
  Alert,
  AttachmentList,
  AttachmentPicker,
  Button,
  buttonVariants,
  CUSTOMER_STATUS_LABELS,
  describeProblem,
  ErrorState,
  Field,
  Panel,
  ReferenceChip,
  RelativeTime,
  Skeleton,
  StatusBadge,
  Textarea,
  Thread,
  ThreadEvent,
  ThreadMessage,
  toast,
} from "@dsd/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PRODUCT_NAME } from "@/components/brand";
import { Container, FormProblem } from "@/components/page";
import { attachmentHref } from "@/lib/links";
import { isAccount, useSession } from "@/lib/session";
import { useReply, useTicket } from "@/lib/tickets";

const EVENT_TONES: Record<
  TicketStatus,
  "neutral" | "info" | "success" | "warning"
> = {
  open: "info",
  pending_customer: "warning",
  resolved: "success",
  closed: "neutral",
};

type Entry =
  | { kind: "message"; at: string; message: CustomerTicket["messages"][number] }
  | { kind: "status"; at: string; status: TicketStatus };

/** Replies and status changes in one time line, so the history reads as one story. */
function entriesOf(ticket: CustomerTicket): Entry[] {
  const entries: Entry[] = [
    ...ticket.messages.map((message) => ({
      kind: "message" as const,
      at: message.createdAt,
      message,
    })),
    // The first timeline entry is the ticket opening, which the description already shows.
    ...ticket.timeline.slice(1).map((change) => ({
      kind: "status" as const,
      at: change.at,
      status: change.status,
    })),
  ];
  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

export function TicketView({ ticketId }: { ticketId: string }) {
  const session = useSession();
  const ticket = useTicket(ticketId);
  const account = isAccount(session.data) ? session.data : undefined;
  const you = account?.customer.displayName ?? "You";

  if (ticket.isPending) {
    return (
      <Container width="reading" className="py-10">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="mt-6 h-7 w-2/3" />
        <Skeleton className="mt-3 h-5 w-48" />
        <div className="mt-10 space-y-5">
          <Skeleton className="h-28" />
          <Skeleton className="h-20" />
        </div>
      </Container>
    );
  }

  if (ticket.isError) {
    const missing =
      ticket.error instanceof ApiProblem && ticket.error.status === 404;
    const message = describeProblem(ticket.error);
    return (
      <Container width="reading" className="py-16">
        <ErrorState
          title={missing ? "We can't find that request" : message.title}
          description={
            missing
              ? "It may belong to a different account or email link. Sign in with the email you used, or ask for a new link."
              : message.description
          }
          requestId={missing ? undefined : message.requestId}
          icon={message.icon}
          onRetry={missing ? undefined : () => void ticket.refetch()}
          action={
            missing ? (
              <Link
                href="/find-ticket"
                className={buttonVariants({ size: "sm" })}
              >
                Get a link by email
              </Link>
            ) : undefined
          }
        />
      </Container>
    );
  }

  const data = ticket.data;
  const files = (attachments: CustomerTicket["attachments"]) =>
    attachments.length === 0 ? undefined : (
      <AttachmentList
        attachments={attachments}
        hrefFor={(attachment) => attachmentHref(data.id, attachment.id)}
      />
    );

  return (
    <Container width="reading" className="py-8 sm:py-10">
      <title>{`${data.subject} · ${PRODUCT_NAME}`}</title>
      {account === undefined ? (
        <Alert tone="info" title="You opened this request from an email link">
          To keep all your requests in one place,{" "}
          <Link href="/signup">create an account</Link> with the same email.
        </Alert>
      ) : (
        <Link
          href="/tickets"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          My requests
        </Link>
      )}

      <header className="mt-6 border-b border-border pb-6">
        <h1 className="text-xl font-semibold text-balance">{data.subject}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
          <ReferenceChip reference={data.reference} />
          <StatusBadge status={data.status} audience="customer" />
          <span>
            Opened <RelativeTime value={data.createdAt} />
          </span>
        </div>
      </header>

      <Thread className="mt-8">
        <ThreadMessage
          author={you}
          tag="Original request"
          createdAt={data.createdAt}
          body={data.description}
          attachments={files(data.attachments)}
        />
        {entriesOf(data).map((entry) =>
          entry.kind === "status" ? (
            <ThreadEvent
              key={`status-${entry.at}`}
              at={entry.at}
              tone={EVENT_TONES[entry.status]}
            >
              Status changed to{" "}
              <span className="font-medium text-foreground">
                {CUSTOMER_STATUS_LABELS[entry.status]}
              </span>
            </ThreadEvent>
          ) : (
            <ThreadMessage
              key={entry.message.id}
              author={
                entry.message.author.type === "agent"
                  ? (entry.message.author.name ?? "Support team")
                  : you
              }
              tag={
                entry.message.author.type === "agent" ? "Support team" : "You"
              }
              emphasis={entry.message.author.type === "agent"}
              createdAt={entry.message.createdAt}
              body={entry.message.body}
              attachments={files(entry.message.attachments)}
            />
          ),
        )}
      </Thread>

      <div className="mt-8">
        {data.canReply ? (
          <ReplyBox ticketId={data.id} />
        ) : (
          <Alert tone="info" title="This request is closed">
            It can&apos;t take new replies. If you still need help,{" "}
            <Link href="/new">send a new request</Link> and mention{" "}
            {data.reference}.
          </Alert>
        )}
      </div>
    </Container>
  );
}

function ReplyBox({ ticketId }: { ticketId: string }) {
  const reply = useReply(ticketId);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string>();
  const problem = reply.error instanceof ApiProblem ? reply.error : undefined;

  return (
    <Panel className="p-4 sm:p-5">
      <form
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const text = body.trim();
          if (text === "") {
            setError("Write a reply before sending.");
            return;
          }
          setError(undefined);
          reply.mutate(
            { body: text, files },
            {
              onSuccess: () => {
                setBody("");
                setFiles([]);
                toast.success("Reply sent");
              },
            },
          );
        }}
      >
        <Field
          label="Reply"
          error={error ?? problem?.fieldError("body")}
          hint="We'll email you when the team answers."
        >
          {(control) => (
            <Textarea
              {...control}
              size="lg"
              rows={4}
              maxLength={20_000}
              placeholder="Add more detail or answer our question…"
              value={body}
              onChange={(event) => {
                setBody(event.target.value);
              }}
            />
          )}
        </Field>
        {problem?.errors.length === 0 ? (
          <FormProblem problem={problem} />
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <AttachmentPicker
            files={files}
            onChange={setFiles}
            compact
            disabled={reply.isPending}
          />
          <Button
            type="submit"
            size="lg"
            pending={reply.isPending}
            className="sm:shrink-0"
          >
            Send reply
          </Button>
        </div>
      </form>
    </Panel>
  );
}
