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
    <div className="grid min-h-[60vh] place-items-center px-4">
      <ErrorState
        title="This page didn't load"
        description="Something went wrong while showing this page. Please try again."
        requestId={error.digest}
        onRetry={reset}
      />
    </div>
  );
}
