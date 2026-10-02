import { buttonVariants } from "@dsd/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="text-center">
        <p className="font-mono text-xs text-muted-foreground">404</p>
        <h1 className="mt-2 text-lg font-semibold">
          There&apos;s no page here
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The link may be incomplete, or the page may have moved.
        </p>
        <Link
          href="/queue"
          className={buttonVariants({ size: "sm", className: "mt-5" })}
        >
          Go to the queue
        </Link>
      </div>
    </main>
  );
}
