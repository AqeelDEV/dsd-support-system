import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "DSD Customer Support",
    template: "%s | DSD Customer Support",
  },
  description: "Get help with your DSD account, orders and deliveries.",
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
          <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4 sm:px-6">
            <span
              aria-hidden="true"
              className="grid size-8 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground"
            >
              D
            </span>
            <span className="text-base font-semibold tracking-tight">
              DSD Customer Support
            </span>
          </div>
        </header>
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="border-t border-border">
          <div className="mx-auto max-w-5xl px-4 py-6 text-sm text-muted-foreground sm:px-6">
            DSD Unified Customer Support
          </div>
        </footer>
      </body>
    </html>
  );
}
