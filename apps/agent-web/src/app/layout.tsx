import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DSD Support Desk",
    template: "%s | DSD Support Desk",
  },
  description: "The workspace for DSD support agents, supervisors and admins.",
  // A staff tool: keep it out of search engines.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:shadow"
        >
          Skip to content
        </a>
        <header className="border-b border-border bg-card">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
            >
              D
            </span>
            <span className="text-sm font-semibold tracking-tight">
              DSD Support Desk
            </span>
          </div>
        </header>
        <main id="main" className="flex-1">
          {children}
        </main>
      </body>
    </html>
  );
}
