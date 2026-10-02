"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import { loginRequestSchema } from "@dsd/shared";
import {
  Alert,
  Button,
  Field,
  type FieldErrors,
  Input,
  PasswordInput,
  ProblemAlert,
  safeNext,
  validateForm,
} from "@dsd/ui";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { api } from "@/lib/api";
import { useSetSession } from "@/lib/session";

type FieldName = "email" | "password";

export function SignInView() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useSetSession();
  const next = safeNext(params.get("next"), "/queue");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<FieldName>>({});

  const signIn = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      ok(api.POST("/api/v1/auth/staff/login", { body })),
    onSuccess: (session) => {
      setSession(session);
      router.replace(next);
    },
  });

  const refused =
    signIn.error instanceof ApiProblem && signIn.error.status === 401;

  return (
    <>
      <h1 className="text-lg font-semibold">Sign in to Support Desk</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Use your DSD staff account.
      </p>
      <form
        noValidate
        className="mt-6 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          const checked = validateForm(
            loginRequestSchema,
            { email: email.trim(), password },
            {
              email: "Enter your work email.",
              password: "Enter your password.",
            },
          );
          setErrors(checked.errors ?? {});
          if (checked.data !== undefined) signIn.mutate(checked.data);
        }}
      >
        {refused ? (
          <Alert tone="danger" title="That didn't work">
            The email or password is wrong, or the account isn&apos;t active.
          </Alert>
        ) : (
          <ProblemAlert problem={signIn.error} />
        )}
        <Field label="Work email" error={errors.email}>
          {(control) => (
            <Input
              {...control}
              type="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          )}
        </Field>
        <Field label="Password" error={errors.password}>
          {(control) => (
            <PasswordInput
              {...control}
              autoComplete="current-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
              }}
            />
          )}
        </Field>
        <Button
          type="submit"
          pending={signIn.isPending}
          className="mt-1 w-full"
        >
          Sign in
        </Button>
        <p className="text-xs text-muted-foreground">
          Forgotten your password? Ask a supervisor or an admin to send you a
          new invite.
        </p>
      </form>
    </>
  );
}
