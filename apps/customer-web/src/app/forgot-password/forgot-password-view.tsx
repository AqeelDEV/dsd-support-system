"use client";

import { ok } from "@dsd/api-client";
import { passwordResetRequestSchema } from "@dsd/shared";
import { Button, Field, Input, validateForm } from "@dsd/ui";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AuthCard, AuthDone } from "@/components/auth-card";
import { FormProblem } from "@/components/page";
import { api } from "@/lib/api";

export function ForgotPasswordView() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();

  const request = useMutation({
    mutationFn: (body: { email: string }) =>
      ok(api.POST("/api/v1/auth/customer/password-reset/request", { body })),
  });

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you signed up with and we'll send you a link to choose a new password."
      footer={
        <Link
          href="/sign-in"
          className="font-medium text-primary hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      {request.isSuccess ? (
        <AuthDone
          icon={<MailCheck aria-hidden="true" />}
          title="Check your email"
        >
          <p>
            If{" "}
            <span className="font-medium text-foreground">
              {request.variables.email}
            </span>{" "}
            has an account, we&apos;ve sent it a reset link. It works once, for
            one hour.
          </p>
        </AuthDone>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            const checked = validateForm(
              passwordResetRequestSchema,
              { email: email.trim() },
              { email: "Enter a valid email address." },
            );
            setError(checked.errors?.email);
            if (checked.data !== undefined) request.mutate(checked.data);
          }}
        >
          <FormProblem problem={request.error} />
          <Field label="Email" error={error}>
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
          <Button type="submit" size="lg" pending={request.isPending}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
