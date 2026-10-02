import { buttonVariants, ErrorState, Spinner } from "@dsd/ui";
import Link from "next/link";

import { Container } from "./page";

/** While an emailed link's token is read from the address bar. */
export function TokenPending() {
  return (
    <Container width="narrow" className="py-24">
      <div role="status" className="flex justify-center text-muted-foreground">
        <Spinner className="size-5" />
        <span className="sr-only">Checking your link</span>
      </div>
    </Container>
  );
}

/** An emailed link that is incomplete, expired or already used, with the way to get a new one. */
export function LinkProblem({
  title,
  description,
  href,
  action,
}: {
  title: string;
  description: string;
  href: string;
  action: string;
}) {
  return (
    <Container width="reading" className="py-16">
      <ErrorState
        title={title}
        description={description}
        action={
          <Link href={href} className={buttonVariants({ size: "sm" })}>
            {action}
          </Link>
        }
      />
    </Container>
  );
}
