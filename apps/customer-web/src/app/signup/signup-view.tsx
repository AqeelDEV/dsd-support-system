"use client";

import { ok } from "@dsd/api-client";
import { signupRequestSchema } from "@dsd/shared";
import { Button, Field, Input, validateForm } from "@dsd/ui";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AuthCard, AuthDone } from "@/components/auth-card";
import { FormProblem } from "@/components/page";
import { api } from "@/lib/api";

/**
 * Sign-up is email-first (ADR-0003, section 6): we email a link, and the
 * account is created when it is opened. The answer is the same whether or
 * not the address already has an account, so this page can't be used to
 * find out who is registered.
 */
export function SignupView() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string>();

  const request = useMutation({
    mutationFn: (body: { email: string }) =>
      ok(api.POST("/api/v1/auth/customer/signup", { body })),
  });

  return (
    <AuthCard
      title="Create an account"
      description="Keep all your requests in one place. If you've contacted us before with this email, those requests will be there too."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      {request.isSuccess ? (
        <AuthDone
          icon={<MailCheck aria-hidden="true" />}
          title="Check your email"
        >
          <p>
            We&apos;ve sent a link to{" "}
            <span className="font-medium text-foreground">
              {request.variables.email}
            </span>
            . Open it within 24 hours to choose your name and password.
          </p>
          <p>
            Nothing there after a few minutes? Check your spam folder, or{" "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => {
                request.reset();
              }}
            >
              try again
            </button>
            .
          </p>
        </AuthDone>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            const checked = validateForm(
              signupRequestSchema,
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
            Email me a link
          </Button>
        </form>
      )}
    </AuthCard>
  );
}
