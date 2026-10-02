"use client";

import { describeProblem, ErrorState, Spinner } from "@dsd/ui";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect } from "react";

import { useSession } from "@/lib/session";

import { Container } from "./page";

/**
 * Pages that need a customer session (an account, or a guest session from
 * an emailed link). Without one, the visitor goes to sign in and comes
 * back here afterwards. The API still decides what the session may see.
 */
export function RequireSession({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const signedOut = session.isSuccess && session.data === null;

  useEffect(() => {
    if (signedOut) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    }
  }, [signedOut, router, pathname]);

  if (session.isError) {
    const message = describeProblem(session.error);
    return (
      <Container width="reading" className="py-16">
        <ErrorState
          title={message.title}
          description={message.description}
          requestId={message.requestId}
          icon={message.icon}
          onRetry={() => void session.refetch()}
        />
      </Container>
    );
  }

  if (session.isPending || signedOut) {
    return (
      <Container width="reading" className="py-24">
        <div
          role="status"
          className="flex justify-center text-muted-foreground"
        >
          <Spinner className="size-5" />
          <span className="sr-only">Loading</span>
        </div>
      </Container>
    );
  }

  return children;
}
