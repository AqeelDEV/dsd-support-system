"use client";

import { ApiProblem, formDataBody, multipart, ok } from "@dsd/api-client";
import {
  customerTicketFieldsSchema,
  guestTicketFieldsSchema,
} from "@dsd/shared";
import {
  AttachmentPicker,
  Button,
  Field,
  type FieldErrors,
  Input,
  Panel,
  ReferenceChip,
  Skeleton,
  Textarea,
  toast,
  validateForm,
} from "@dsd/ui";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";

import { ArticleRow } from "@/components/kb";
import { Container, FormProblem, PageIntro } from "@/components/page";
import { api } from "@/lib/api";
import { useArticles } from "@/lib/kb";
import { isAccount, useSession } from "@/lib/session";

type FieldName = "email" | "subject" | "description";

const MESSAGES: Record<FieldName, string> = {
  email: "Enter the email address we should reply to.",
  subject: "Add a short summary, up to 200 characters.",
  description: "Tell us what happened, up to 20,000 characters.",
};

export function NewTicketView() {
  const router = useRouter();
  const session = useSession();
  const account = isAccount(session.data) ? session.data : undefined;

  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<FieldErrors<FieldName>>({});
  const [sent, setSent] = useState<{ reference: string; email: string }>();

  // Suggest articles that match the subject while the customer types (FR-4).
  const topic = useDeferredValue(subject.trim());
  const suggestions = useArticles({
    q: topic,
    limit: 3,
    enabled: topic.length >= 4,
  });
  const suggested =
    topic.length >= 4 ? (suggestions.data?.pages[0]?.items ?? []) : [];

  type Payload =
    | { kind: "account"; fields: { subject: string; description: string } }
    | {
        kind: "guest";
        fields: { email: string; subject: string; description: string };
      };

  const submit = useMutation({
    mutationFn: async (payload: Payload) => {
      if (payload.kind === "account") {
        const ticket = await ok(
          api.POST("/api/v1/customer/tickets", {
            body: multipart(payload.fields, files) as never,
            ...formDataBody,
          }),
        );
        return { kind: "account" as const, ticket };
      }
      const receipt = await ok(
        api.POST("/api/v1/public/tickets", {
          body: multipart(payload.fields, files) as never,
          ...formDataBody,
        }),
      );
      return { kind: "guest" as const, receipt, email: payload.fields.email };
    },
    onSuccess: (result) => {
      if (result.kind === "account") {
        toast.success(`Request ${result.ticket.reference} sent`, {
          description: "We'll email you when we reply.",
        });
        router.push(`/tickets/${result.ticket.id}`);
      } else {
        setSent({ reference: result.receipt.reference, email: result.email });
        window.scrollTo({ top: 0 });
      }
    },
    onError: (error) => {
      if (error instanceof ApiProblem) {
        setErrors({
          email: error.fieldError("email"),
          subject: error.fieldError("subject"),
          description: error.fieldError("description"),
        });
      }
    },
  });

  /** Checks the form with the shared schema first; only valid input reaches the API. */
  const send = () => {
    const { subject: subjectMessage, description: descriptionMessage } =
      MESSAGES;
    if (account !== undefined) {
      const checked = validateForm(
        customerTicketFieldsSchema,
        { subject, description },
        { subject: subjectMessage, description: descriptionMessage },
      );
      setErrors(checked.errors ?? {});
      if (checked.data !== undefined) {
        submit.mutate({ kind: "account", fields: checked.data });
      }
      return;
    }
    const checked = validateForm(
      guestTicketFieldsSchema,
      { email: email.trim(), subject, description },
      MESSAGES,
    );
    setErrors(checked.errors ?? {});
    if (checked.data !== undefined) {
      submit.mutate({ kind: "guest", fields: checked.data });
    }
  };

  if (sent !== undefined) {
    return (
      <Container width="reading" className="py-12 sm:py-16">
        <Panel className="px-6 py-8 sm:px-10 sm:py-10">
          <div role="status">
            <span className="grid size-11 place-items-center rounded-lg bg-tone-success-soft text-tone-success-fg">
              <MailCheck aria-hidden="true" className="size-5" />
            </span>
            <h1 className="mt-5 text-xl font-semibold">
              We&apos;ve got your request
            </h1>
            <p className="mt-2 text-muted-foreground">
              Your reference is{" "}
              <ReferenceChip
                reference={sent.reference}
                className="align-middle"
              />
              . We&apos;ve sent a link to{" "}
              <span className="font-medium text-foreground">{sent.email}</span>{" "}
              where you can follow the conversation and reply.
            </p>
          </div>
          <ul className="mt-6 space-y-2 border-t border-border pt-6 text-base text-muted-foreground">
            <li>
              Don&apos;t see the email in a few minutes? Check your spam folder,
              or{" "}
              <Link
                href="/find-ticket"
                className="font-medium text-primary hover:underline"
              >
                ask for a new link
              </Link>
              .
            </li>
            <li>
              Want all your requests in one place?{" "}
              <Link
                href="/signup"
                className="font-medium text-primary hover:underline"
              >
                Create an account
              </Link>{" "}
              with the same email.
            </li>
          </ul>
        </Panel>
      </Container>
    );
  }

  return (
    <Container className="py-10 sm:py-12">
      <PageIntro
        title="Contact support"
        description="Tell us what's going on and we'll reply by email. The more detail you give, the faster we can help."
      />
      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <Panel className="p-5 sm:p-7">
          {session.isPending ? (
            <div className="space-y-6" aria-hidden="true">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
              <Skeleton className="h-40" />
            </div>
          ) : (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                send();
              }}
              className="flex flex-col gap-6"
            >
              <FormProblem
                problem={
                  submit.error instanceof ApiProblem &&
                  submit.error.errors.length === 0
                    ? submit.error
                    : undefined
                }
              />
              {account === undefined ? (
                <Field
                  label="Your email"
                  hint={
                    <>
                      We&apos;ll send replies and a link to this request here.
                      Have an account?{" "}
                      <Link
                        href="/sign-in?next=/new"
                        className="font-medium text-primary hover:underline"
                      >
                        Sign in
                      </Link>
                    </>
                  }
                  error={errors.email}
                >
                  {(control) => (
                    <Input
                      {...control}
                      size="lg"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                      }}
                    />
                  )}
                </Field>
              ) : (
                <p className="rounded-md border border-border bg-muted/50 px-3.5 py-2.5 text-base text-muted-foreground">
                  We&apos;ll reply to{" "}
                  <span className="font-medium text-foreground">
                    {account.customer.email}
                  </span>
                  .
                </p>
              )}
              <Field
                label="Subject"
                aside={`${subject.length}/200`}
                error={errors.subject}
              >
                {(control) => (
                  <Input
                    {...control}
                    size="lg"
                    maxLength={200}
                    placeholder="e.g. Hub won't connect after the update"
                    value={subject}
                    onChange={(event) => {
                      setSubject(event.target.value);
                    }}
                  />
                )}
              </Field>
              <Field
                label="What happened?"
                hint="Include what you expected, what you saw, and any error messages or order numbers."
                error={errors.description}
              >
                {(control) => (
                  <Textarea
                    {...control}
                    size="lg"
                    rows={8}
                    maxLength={20_000}
                    value={description}
                    onChange={(event) => {
                      setDescription(event.target.value);
                    }}
                  />
                )}
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  Attachments{" "}
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </span>
                <AttachmentPicker
                  files={files}
                  onChange={setFiles}
                  disabled={submit.isPending}
                  error={
                    submit.error instanceof ApiProblem &&
                    (submit.error.status === 413 || submit.error.status === 415)
                      ? submit.error.message
                      : undefined
                  }
                />
              </div>
              <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  You&apos;ll get a confirmation email straight away.
                </p>
                <Button type="submit" size="lg" pending={submit.isPending}>
                  Send request
                </Button>
              </div>
            </form>
          )}
        </Panel>
        <aside aria-label="Articles that might help" className="lg:pt-1">
          <h2 className="text-sm font-semibold">These might help</h2>
          {suggested.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              As you type a subject, we&apos;ll suggest help articles that might
              answer it straight away.
            </p>
          ) : (
            <Panel className="mt-3 overflow-hidden">
              <ul className="divide-y divide-border">
                {suggested.map((article) => (
                  <ArticleRow key={article.slug} article={article} compact />
                ))}
              </ul>
            </Panel>
          )}
        </aside>
      </div>
    </Container>
  );
}
