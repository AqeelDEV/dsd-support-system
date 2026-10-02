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
  safeNext,
  validateForm,
} from "@dsd/ui";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { AuthCard } from "@/components/auth-card";
import { FormProblem } from "@/components/page";
import { api } from "@/lib/api";
import { useSetSession } from "@/lib/session";

type FieldName = "email" | "password";

export function SignInView() {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useSetSession();
  const next = safeNext(params.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<FieldName>>({});

  const signIn = useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      ok(api.POST("/api/v1/auth/customer/login", { body })),
    onSuccess: (session) => {
      setSession(session);
      router.replace(next);
    },
  });

  const wrongCredentials =
    signIn.error instanceof ApiProblem && signIn.error.status === 401;

  return (
    <AuthCard
      title="Sign in"
      description="See all your requests and our replies in one place."
      footer={
        <>
          New here?{" "}
          <Link
            href="/signup"
            className="font-medium text-primary hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const checked = validateForm(
            loginRequestSchema,
            { email: email.trim(), password },
            {
              email: "Enter your email address.",
              password: "Enter your password.",
            },
          );
          setErrors(checked.errors ?? {});
          if (checked.data !== undefined) signIn.mutate(checked.data);
        }}
      >
        {wrongCredentials ? (
          <Alert tone="danger" title="That didn't work">
            The email or password is wrong. Check them and try again.
          </Alert>
        ) : (
          <FormProblem problem={signIn.error} />
        )}
        <Field label="Email" error={errors.email}>
          {(control) => (
            <Input
              {...control}
              size="lg"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label="Password"
          error={errors.password}
          aside={
            <Link
              href="/forgot-password"
              className="font-medium text-primary hover:underline"
            >
              Forgot your password?
            </Link>
          }
        >
          {(control) => (
            <PasswordInput
              {...control}
              size="lg"
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
          size="lg"
          pending={signIn.isPending}
          className="mt-1"
        >
          Sign in
        </Button>
      </form>
    </AuthCard>
  );
}
