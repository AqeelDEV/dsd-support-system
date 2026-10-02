import Link from "next/link";

import { PRODUCT_NAME } from "./brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <p>{PRODUCT_NAME}: help with your account, orders and devices.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/help" className="hover:text-foreground">
            Help centre
          </Link>
          <Link href="/new" className="hover:text-foreground">
            Contact support
          </Link>
          <Link href="/find-ticket" className="hover:text-foreground">
            Find a request
          </Link>
        </nav>
      </div>
    </footer>
  );
}
