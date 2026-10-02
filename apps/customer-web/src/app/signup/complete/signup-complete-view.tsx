"use client";

import { ApiProblem, ok } from "@dsd/api-client";
import {
  PASSWORD_POLICY,
  PROBLEM_TYPES,
  signupCompleteRequestSchema,
} from "@dsd/shared";
import {
  Button,
  Field,
  type FieldErrors,
  Input,
  PasswordInput,
  toast,
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
import { useHashToken } from "@/lib/use-hash-token";

type FieldName = "displayName" | "password";

export function SignupCompleteView() {
  const router = useRouter();
  const setSession = useSetSession();
  const hash = useHashToken();
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<FieldName>>({});

  const complete = useMutation({
    mutationFn: (body: {
      token: string;
      displayName: string;
      password: string;
    }) => ok(api.POST("/api/v1/auth/customer/signup/complete", { body })),
    onSuccess: (session) => {
      setSession(session);
      toast.success("Your account is ready");
      router.replace("/tickets");
    },
  });

  if (hash.state === "reading") return <TokenPending />;
  if (
    hash.state === "missing" ||
    (complete.error instanceof ApiProblem &&
      complete.error.type === PROBLEM_TYPES.invalidToken)
  ) {
    return (
      <LinkProblem
        title="This sign-up link has expired or was already used"
        description="Sign-up links work once, for 24 hours. Ask for a new one and we'll email it straight away."
        href="/signup"
        action="Get a new link"
      />
    );
  }

  return (
    <AuthCard
      title="Finish creating your account"
      description="Choose the name we'll use when we reply, and a password."
    >
      <form
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          const checked = validateForm(
            signupCompleteRequestSchema,
            { token: hash.token, displayName, password },
            {
              token: "",
              displayName: "Enter your name, up to 100 characters.",
              password: `Use ${PASSWORD_POLICY.minLength} to ${PASSWORD_POLICY.maxLength} characters.`,
            },
          );
          setErrors(checked.errors ?? {});
          if (checked.data !== undefined) complete.mutate(checked.data);
        }}
      >
        <FormProblem problem={complete.error} />
        <Field label="Your name" error={errors.displayName}>
          {(control) => (
            <Input
              {...control}
              size="lg"
              autoComplete="name"
              maxLength={100}
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
            />
          )}
        </Field>
        <Field
          label="Password"
          hint={`At least ${PASSWORD_POLICY.minLength} characters. A short phrase is easier to remember than a jumble.`}
          error={errors.password}
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
        <Button type="submit" size="lg" pending={complete.isPending}>
          Create account
        </Button>
      </form>
    </AuthCard>
  );
}
