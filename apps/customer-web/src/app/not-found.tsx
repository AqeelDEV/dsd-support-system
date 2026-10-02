import { buttonVariants } from "@dsd/ui";
import Link from "next/link";

export default function NotFound() {
  return (
    <section className="mx-auto flex max-w-xl flex-col items-center px-4 py-24 text-center sm:px-6">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <h1 className="mt-2 text-xl font-semibold">
        We can&apos;t find that page
      </h1>
      <p className="mt-2 text-muted-foreground">
        It may have moved, or the link may be incomplete.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link href="/" className={buttonVariants({ size: "lg" })}>
          Go to the home page
        </Link>
        <Link
          href="/help"
          className={buttonVariants({ variant: "secondary", size: "lg" })}
        >
          Search the help centre
        </Link>
      </div>
    </section>
  );
}
