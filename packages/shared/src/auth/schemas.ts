import { z } from "zod";

import { agentRoleSchema } from "../domain/enums.js";
import { PASSWORD_POLICY } from "../domain/password.js";
import { permissionSchema } from "./permissions.js";

/*
 * Request and response shapes for sign-in, sign-up and guest access
 * (ADR-0003). Request objects are strict: an unknown field is a 400, so
 * nothing can be smuggled into an endpoint that doesn't expect it.
 */

/** An email address as people type it; shared with ticket submission. */
export const emailSchema = z.email().max(254).meta({
  description: "Compared case-insensitively",
  example: "customer@example.com",
});

/**
 * Sign-in only checks the upper bound: a long "password" would burn CPU on
 * hashing, and a short one simply fails to match.
 */
const currentPassword = z.string().min(1).max(PASSWORD_POLICY.maxLength);

/** Length is the only rule (NIST SP 800-63B); no composition rules. */
const newPassword = z
  .string()
  .min(PASSWORD_POLICY.minLength)
  .max(PASSWORD_POLICY.maxLength)
  .describe(
    `${PASSWORD_POLICY.minLength} to ${PASSWORD_POLICY.maxLength} characters`,
  );

/** 32 random bytes, base64url-encoded: exactly what the emailed links carry. */
const emailedToken = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/, "must be the token from the emailed link")
  .describe("The token from the emailed link");

export const loginRequestSchema = z.strictObject({
  email: emailSchema,
  password: currentPassword,
});

export const signupRequestSchema = z.strictObject({ email: emailSchema });

export const signupCompleteRequestSchema = z.strictObject({
  token: emailedToken,
  displayName: z.string().trim().min(1).max(100),
  password: newPassword,
});

export const guestAccessRequestSchema = z.strictObject({
  email: emailSchema,
  reference: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2,8}-\d{6,}$/, "must look like DSD-000123")
    .describe("The ticket reference from an earlier email, like DSD-000123"),
});

export const guestAccessExchangeRequestSchema = z.strictObject({
  token: emailedToken,
});

export const inviteCompleteRequestSchema = z.strictObject({
  token: emailedToken,
  password: newPassword,
});

const csrfToken = z
  .string()
  .describe(
    "Send this back in the X-CSRF-Token header on every POST, PUT, PATCH and DELETE",
  );

export const customerMeSchema = z.object({
  customer: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string().nullable(),
  }),
  guestTicketId: z
    .uuid()
    .nullable()
    .describe(
      "Set for a guest session, which can see this one ticket and nothing else",
    ),
  csrfToken,
});

export const staffMeSchema = z.object({
  agent: z.object({
    id: z.uuid(),
    email: z.string(),
    displayName: z.string(),
    role: agentRoleSchema,
  }),
  permissions: z
    .array(permissionSchema)
    .describe(
      "What this agent may do. The agent app shows controls from this list; the API enforces it regardless",
    ),
  csrfToken,
});

export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type SignupCompleteRequest = z.infer<typeof signupCompleteRequestSchema>;
export type GuestAccessRequest = z.infer<typeof guestAccessRequestSchema>;
export type GuestAccessExchangeRequest = z.infer<
  typeof guestAccessExchangeRequestSchema
>;
export type InviteCompleteRequest = z.infer<typeof inviteCompleteRequestSchema>;
export type CustomerMe = z.infer<typeof customerMeSchema>;
export type StaffMe = z.infer<typeof staffMeSchema>;
