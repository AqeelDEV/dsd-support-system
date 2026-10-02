import { cn, ProblemAlert } from "@dsd/ui";
import type { ReactNode } from "react";

/** The customer app's content width: wide for browsing, 720 px for reading (ADR-0013). */
export function Container({
  children,
  width = "wide",
  className,
}: {
  children: ReactNode;
  width?: "wide" | "reading" | "narrow";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6",
        width === "wide" && "max-w-5xl",
        width === "reading" && "max-w-[45rem]",
        width === "narrow" && "max-w-[26rem]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageIntro({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow === undefined ? null : (
          <div className="mb-2 text-sm text-muted-foreground">{eyebrow}</div>
        )}
        <h1 className="text-xl font-semibold text-balance">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-1.5 text-muted-foreground">{description}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex shrink-0 gap-2">{actions}</div>
      )}
    </div>
  );
}

/** A form-level failure, worded the same way in both apps. */
export const FormProblem = ProblemAlert;
