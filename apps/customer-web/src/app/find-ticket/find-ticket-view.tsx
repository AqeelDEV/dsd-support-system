"use client";

import { ok } from "@dsd/api-client";
import { guestAccessRequestSchema } from "@dsd/shared";
import { Button, Field, type FieldErrors, Input, validateForm } from "@dsd/ui";
import { useMutation } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AuthCard, AuthDone } from "@/components/auth-card";
import { FormProblem } from "@/components/page";
import { api } from "@/lib/api";

type FieldName = "email" | "reference";

/**
 * A guest asks for a fresh link to one request (FR-2). The answer is the
 * same whether or not the pair matches, so nobody can probe for requests.
 */
export function FindTicketView() {
  const [email, setEmail] = useState("");
  const [reference, setReference] = useState("");
  const [errors, setErrors] = useState<FieldErrors<FieldName>>({});

  const request = useMutation({
    mutationFn: (body: { email: string; reference: string }) =>
      ok(api.POST("/api/v1/auth/customer/guest-access/request", { body })),
  });

  return (
    <AuthCard
      title="Find a request"
      description="We'll email you a link to follow it and reply. Use the email you contacted us with and the reference from our emails."
      footer={
        <>
          Have an account?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-primary hover:underline"
          >
            Sign in
          </Link>{" "}
          to see all your requests.
        </>
      }
    >
      {request.isSuccess ? (
        <AuthDone
          icon={<MailCheck aria-hidden="true" />}
          title="Check your email"
        >
          <p>
            If {request.variables.reference.toUpperCase()} belongs to{" "}
            <span className="font-medium text-foreground">
              {request.variables.email}
            </span>
            , a link to it is on its way. It works for 7 days.
          </p>
        </AuthDone>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault();
            const checked = validateForm(
              guestAccessRequestSchema,
              { email: email.trim(), reference: reference.trim() },
              {
                email: "Enter a valid email address.",
                reference:
                  "Enter the reference from our email, like DSD-000123.",
              },
            );
            setErrors(checked.errors ?? {});
            if (checked.data !== undefined) request.mutate(checked.data);
          }}
        >
          <FormProblem problem={request.error} />
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
            label="Reference"
            hint="For example DSD-000123."
            error={errors.reference}
          >
            {(control) => (
              <Input
                {...control}
                size="lg"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                className="font-mono"
                value={reference}
                onChange={(event) => {
                  setReference(event.target.value);
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
