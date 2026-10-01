import { createHash, randomBytes } from "node:crypto";

import type { Database } from "@dsd/db";
import { authTokens } from "@dsd/db/schema";
import type { AuthTokenPurpose } from "@dsd/shared";
import { sql } from "drizzle-orm";

import type { Env } from "../config/env.js";

/**
 * How long each emailed link lasts (ADR-0003, sections 6 to 8, and the
 * password-reset amendment).
 */
export const LINK_LIFETIME_MINUTES: Readonly<Record<AuthTokenPurpose, number>> =
  {
    guest_ticket_access: 7 * 24 * 60,
    customer_signup: 24 * 60,
    agent_invite: 72 * 60,
    password_reset: 60,
  };

type Subject =
  | { purpose: "guest_ticket_access"; customerId: string; ticketId: string }
  | { purpose: "customer_signup" | "password_reset"; customerId: string }
  | { purpose: "agent_invite"; agentId: string };

/**
 * Creates the token for an emailed link, at the moment the email is sent
 * (ADR-0003, section 9): 32 random bytes, of which only the SHA-256 hash is
 * stored. The raw token exists only in the email. The worker may insert
 * tokens but never read them back.
 */
export async function createLinkToken(
  db: Database,
  subject: Subject,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(authTokens).values({
    purpose: subject.purpose,
    tokenHash: createHash("sha256").update(token).digest(),
    customerId: "customerId" in subject ? subject.customerId : null,
    agentId: "agentId" in subject ? subject.agentId : null,
    ticketId: "ticketId" in subject ? subject.ticketId : null,
    expiresAt: sql`now() + make_interval(mins => ${LINK_LIFETIME_MINUTES[subject.purpose]})`,
  });
  return token;
}

/**
 * The pages emails link to. Tokens go in the URL fragment, which browsers
 * never send to a server, so they can't leak into logs or `Referer`
 * headers; the page posts them to the API (ADR-0003, section 6).
 */
export class Links {
  private readonly customer: string;
  private readonly agent: string;

  constructor(env: Pick<Env, "CUSTOMER_APP_URL" | "AGENT_APP_URL">) {
    this.customer = env.CUSTOMER_APP_URL;
    this.agent = env.AGENT_APP_URL;
  }

  guestAccess = (token: string) => `${this.customer}/access#token=${token}`;
  customerTicket = (ticketId: string) => `${this.customer}/tickets/${ticketId}`;
  signupComplete = (token: string) =>
    `${this.customer}/signup/complete#token=${token}`;
  signIn = () => `${this.customer}/sign-in`;
  signup = () => `${this.customer}/signup`;
  forgotPassword = () => `${this.customer}/forgot-password`;
  passwordReset = (token: string) =>
    `${this.customer}/reset-password#token=${token}`;
  agentInvite = (token: string) => `${this.agent}/invite#token=${token}`;
}
