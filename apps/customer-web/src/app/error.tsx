"use client";

import { ErrorState } from "@dsd/ui";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-xl px-4 py-16 sm:px-6">
      <ErrorState
        title="This page didn't load"
        description="Something went wrong while showing this page. Please try again."
        requestId={error.digest}
        onRetry={reset}
      />
    </div>
  );
}
