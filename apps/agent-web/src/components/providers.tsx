"use client";

import { ApiProblem } from "@dsd/api-client";
import { Toaster, TooltipProvider } from "@dsd/ui";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

/**
 * Data comes from the API on the client, through the app's `/api` proxy
 * (ADR-0013). A failed read is retried once, unless it was a 4xx: those
 * give the same answer on a retry.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failures, error) =>
              failures < 1 &&
              !(
                error instanceof ApiProblem &&
                error.status >= 400 &&
                error.status < 500
              ),
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>
        {children}
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
