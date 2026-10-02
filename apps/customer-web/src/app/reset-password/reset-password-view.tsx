"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import {
  PASSWORD_POLICY,
  passwordResetCompleteRequestSchema,
  PROBLEM_TYPES,
} from "@dsd/shared";
import {
  Button,
  Field,
  PasswordInput,
  toast,
  useHashToken,
  validateForm,
} from "@dsd/ui";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { LinkProblem, TokenPending } from "@/components/link-states";
import { FormProblem } from "@/components/page";
import { api } from "@/lib/api";
import { useSetSession } from "@/lib/session";

/**
 * The page behind a password-reset email. Completing it signs this browser
 * in and signs out every other session (ADR-0003, amended in Phase 6).
 */
export function ResetPasswordView() {
  const router = useRouter();
  const setSession = useSetSession();
  const hash = useHashToken();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();

  const reset = useMutation({
    mutationFn: (body: { token: string; password: string }) =>
      ok(api.POST("/api/v1/auth/customer/password-reset/complete", { body })),
    onSuccess: (session) => {
      setSession(session);
      toast.success("Password changed", {
        description: "You're signed in, and signed out everywhere else.",
      });
      router.replace("/tickets");
    },
  });

  if (hash.state === "reading") return <TokenPending />;
  if (
    hash.state === "missing" ||
    (reset.error instanceof ApiProblem &&
      reset.error.type === PROBLEM_TYPES.invalidToken)
  ) {
    return (
      <LinkProblem
        title="This reset link has expired or was already used"
        description="Reset links work once, for one hour. Ask for a new one and we'll email it straight away."
        href="/forgot-password"
        action="Get a new link"
      />
    );
  }

  return (
    <AuthCard title="Choose a new password">
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const checked = validateForm(
            passwordResetCompleteRequestSchema,
            { token: hash.token, password },
            {
              token: "",
              password: `Use ${PASSWORD_POLICY.minLength} to ${PASSWORD_POLICY.maxLength} characters.`,
            },
          );
          setError(checked.errors?.password);
          if (checked.data !== undefined) reset.mutate(checked.data);
        }}
      >
        <FormProblem problem={reset.error} />
        <Field
          label="New password"
          hint={`At least ${PASSWORD_POLICY.minLength} characters.`}
          error={error}
        >
          {(control) => (
            <PasswordInput
              {...control}
              size="lg"
              autoComplete="new-password"
              maxLength={PASSWORD_POLICY.maxLength}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          )}
        </Field>
        <Button type="submit" size="lg" pending={reset.isPending}>
          Save password and sign in
        </Button>
      </form>
    </AuthCard>
  );
}
