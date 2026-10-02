"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import {
  buttonVariants,
  describeProblem,
  ErrorState,
  Spinner,
  useHashToken,
} from "@dsd/ui";
import { PROBLEM_TYPES } from "@dsd/shared";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { Container } from "@/components/page";
import { api } from "@/lib/api";
import { useSetSession } from "@/lib/session";

/**
 * The guest link from a ticket email (FR-2; ADR-0003, section 6). The
 * token is exchanged for a session that can see this one request, and the
 * customer lands on its thread.
 */
export function AccessView() {
  const router = useRouter();
  const setSession = useSetSession();
  const hash = useHashToken();

  const exchange = useMutation({
    mutationFn: (token: string) =>
      ok(
        api.POST("/api/v1/auth/customer/guest-access/exchange", {
          body: { token },
        }),
      ),
    onSuccess: (session) => {
      setSession(session);
      router.replace(
        session.guestTicketId === null
          ? "/tickets"
          : `/tickets/${session.guestTicketId}`,
      );
    },
  });

  // Exchange once, even when React runs effects twice in development: a
  // second exchange of the same link must not race the first.
  const { mutate } = exchange;
  const started = useRef(false);
  useEffect(() => {
    if (hash.state !== "found" || started.current) return;
    started.current = true;
    mutate(hash.token);
  }, [hash, mutate]);

  const invalid =
    hash.state === "missing" ||
    (exchange.error instanceof ApiProblem &&
      exchange.error.type === PROBLEM_TYPES.invalidToken);

  if (invalid) {
    return (
      <Container width="reading" className="py-16">
        <ErrorState
          title="This link has expired or was already used"
          description="Links to a request work for 7 days. We can email you a fresh one."
          action={
            <Link
              href="/find-ticket"
              className={buttonVariants({ size: "sm" })}
            >
              Get a new link
            </Link>
          }
        />
      </Container>
    );
  }

  if (exchange.isError) {
    const message = describeProblem(exchange.error);
    return (
      <Container width="reading" className="py-16">
        <ErrorState
          title={message.title}
          description={message.description}
          requestId={message.requestId}
          icon={message.icon}
          onRetry={
            hash.state === "found"
              ? () => {
                  mutate(hash.token);
                }
              : undefined
          }
        />
      </Container>
    );
  }

  return (
    <Container width="reading" className="py-24">
      <div
        role="status"
        className="flex flex-col items-center gap-3 text-muted-foreground"
      >
        <Spinner className="size-5" />
        <p>Opening your request…</p>
      </div>
    </Container>
  );
}
