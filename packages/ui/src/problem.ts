/*
 * Plain-language wording for a failed API call, shared by both apps. It
 * takes the problem's shape rather than the api-client's class, because
 * this package doesn't depend on the client (ADR-0002).
 */

export interface ProblemLike {
  status: number;
  title: string;
  detail?: string | undefined;
  requestId?: string | undefined;
  retryAfterSeconds?: number | undefined;
}

export interface ProblemMessage {
  title: string;
  description: string;
  requestId: string | undefined;
  icon: "error" | "offline" | "forbidden";
}

const waitFor = (seconds: number | undefined) => {
  if (seconds === undefined) return "a little while";
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} seconds`;
  return `${Math.round(seconds / 60)} minutes`;
};

export function describeProblem(problem: unknown): ProblemMessage {
  if (!isProblem(problem)) {
    return {
      title: "Something went wrong",
      description: "Please try again in a moment.",
      requestId: undefined,
      icon: "error",
    };
  }
  const base = { requestId: problem.requestId };
  switch (true) {
    case problem.status === 0:
      return {
        ...base,
        title: "Can't reach the server",
        description: "Check your connection and try again.",
        icon: "offline",
      };
    case problem.status === 429:
      return {
        ...base,
        title: "Too many attempts",
        description: `Please wait ${waitFor(problem.retryAfterSeconds)} and try again.`,
        icon: "error",
      };
    case problem.status === 503:
      return {
        ...base,
        title: "Temporarily unavailable",
        description:
          "This part of the service is having trouble right now. Please try again shortly.",
        icon: "error",
      };
    case problem.status === 403:
      return {
        ...base,
        title: "You don't have access to this",
        description:
          problem.detail ??
          "Your account doesn't have permission for this action.",
        icon: "forbidden",
      };
    case problem.status === 404:
      return {
        ...base,
        title: "Not found",
        description: "It may have been removed, or the link may be wrong.",
        icon: "error",
      };
    case problem.status >= 500:
      return {
        ...base,
        title: "Something went wrong on our side",
        description: "Please try again in a moment.",
        icon: "error",
      };
    default:
      return {
        ...base,
        title: problem.title,
        description: problem.detail ?? "Please check and try again.",
        icon: "error",
      };
  }
}

function isProblem(value: unknown): value is ProblemLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { status?: unknown }).status === "number" &&
    typeof (value as { title?: unknown }).title === "string"
  );
}
