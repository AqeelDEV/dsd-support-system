import Link from "next/link";

/** The workspace's name, set once. Its colours come from the design tokens. */
export const PRODUCT_NAME = "Support Desk";

export function Wordmark({ href = "/queue" }: { href?: string }) {
  return (
    <Link
      href={href}
      aria-label={`DSD ${PRODUCT_NAME}, queue`}
      className="flex items-center gap-2 rounded-md text-sm font-semibold tracking-tight"
    >
      <span
        aria-hidden="true"
        className="grid h-6 place-items-center rounded-[5px] bg-foreground px-1.5 text-[0.5625rem] font-bold tracking-wide text-background"
      >
        DSD
      </span>
      <span>{PRODUCT_NAME}</span>
    </Link>
  );
}
