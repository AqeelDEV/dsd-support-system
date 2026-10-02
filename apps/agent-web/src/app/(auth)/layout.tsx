import type { ReactNode } from "react";

import { Wordmark } from "@/components/brand";

/** Sign-in and the invite page: one small panel on the canvas. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main
      id="main"
      className="flex min-h-dvh flex-col items-center px-4 pt-[12vh] pb-12"
    >
      <Wordmark href="/sign-in" />
      <div className="mt-8 w-full max-w-sm rounded-xl border border-border bg-card px-6 py-7">
        {children}
      </div>
      <p className="mt-6 max-w-sm text-center text-xs text-muted-foreground">
        For DSD support staff. Customers can get help at the customer help
        centre.
      </p>
    </main>
  );
}
