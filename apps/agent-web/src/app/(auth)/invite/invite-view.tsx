"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import {
  inviteCompleteRequestSchema,
  PASSWORD_POLICY,
  PROBLEM_TYPES,
} from "@dsd/shared";
import {
  Button,
  Field,
  PasswordInput,
  ProblemAlert,
  Spinner,
  toast,
  useHashToken,
  validateForm,
} from "@dsd/ui";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";
import { useSetSession } from "@/lib/session";

/**
 * The page behind an invite email (ADR-0003, section 8): the new colleague
 * chooses a password and is signed in. The link works once, for 72 hours.
 */
export function InviteView() {
  const router = useRouter();
  const setSession = useSetSession();
  const hash = useHashToken();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();

  const accept = useMutation({
    mutationFn: (body: { token: string; password: string }) =>
      ok(api.POST("/api/v1/auth/staff/invite/complete", { body })),
    onSuccess: async (session) => {
      await setSession(session);
      toast.success(`Welcome, ${session.agent.displayName}`);
      router.replace("/queue");
    },
  });

  if (hash.state === "reading") {
    return (
      <div
        role="status"
        className="flex justify-center py-6 text-muted-foreground"
      >
        <Spinner className="size-5" />
        <span className="sr-only">Checking your invite</span>
      </div>
    );
  }

  if (
    hash.state === "missing" ||
    (accept.error instanceof ApiProblem &&
      accept.error.type === PROBLEM_TYPES.invalidToken)
  ) {
    return (
      <div role="alert">
        <h1 className="text-lg font-semibold">
          This invite has expired or was already used
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Invites work once, for 72 hours. Ask the supervisor or admin who
          invited you to send it again from the Team page.
        </p>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-lg font-semibold">Join the support team</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose a password to finish setting up your account.
      </p>
      <form
        noValidate
        className="mt-6 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const checked = validateForm(
            inviteCompleteRequestSchema,
            { token: hash.token, password },
            {
              token: "",
              password: `Use ${PASSWORD_POLICY.minLength} to ${PASSWORD_POLICY.maxLength} characters.`,
            },
          );
          setError(checked.errors?.password);
          if (checked.data !== undefined) accept.mutate(checked.data);
        }}
      >
        <ProblemAlert problem={accept.error} />
        <Field
          label="Password"
          hint={`At least ${PASSWORD_POLICY.minLength} characters.`}
          error={error}
        >
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="new-password"
              maxLength={PASSWORD_POLICY.maxLength}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" pending={accept.isPending} className="w-full">
          Set password and sign in
        </Button>
      </form>
    </>
  );
}
