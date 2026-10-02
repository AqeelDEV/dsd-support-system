import Link from "next/link";

/** The product's name, set once. Its colours come from the design tokens. */
export const PRODUCT_NAME = "DSD Support";

export function Wordmark() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2.5 rounded-md text-base font-semibold tracking-tight"
    >
      <span
        aria-hidden="true"
        className="grid h-7 place-items-center rounded-md bg-foreground px-1.5 text-[0.625rem] font-bold tracking-wide text-background"
      >
        DSD
      </span>
      <span>
        Support<span className="sr-only">, home</span>
      </span>
    </Link>
  );
}
