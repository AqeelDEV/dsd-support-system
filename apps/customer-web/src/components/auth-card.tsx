import type { ReactNode } from "react";

import { Container } from "./page";

/**
 * The frame for sign-in, sign-up and the pages behind emailed links: one
 * narrow panel on the canvas, so the form is the only thing on the page.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Container width="narrow" className="py-12 sm:py-20">
      <div className="rounded-xl border border-border bg-card px-6 py-7 sm:px-8 sm:py-8">
        <h1 className="text-xl font-semibold">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1.5 text-base text-muted-foreground">
            {description}
          </p>
        )}
        <div className="mt-6">{children}</div>
      </div>
      {footer === undefined ? null : (
        <div className="mt-5 text-center text-base text-muted-foreground">
          {footer}
        </div>
      )}
    </Container>
  );
}

/** Shown in place of a form once it has done its job, e.g. "check your email". */
export function AuthDone({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
}) {
  return (
    <div role="status" className="flex flex-col items-start gap-3">
      <span className="grid size-10 place-items-center rounded-lg border border-border bg-muted text-muted-foreground [&_svg]:size-5">
        {icon}
      </span>
      <p className="text-md font-semibold">{title}</p>
      <div className="space-y-2 text-base text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
