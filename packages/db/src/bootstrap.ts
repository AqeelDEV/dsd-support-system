import { randomUUID } from "node:crypto";

import {
  type AuditAction,
  emailSchema,
  normalizeEmail,
  parseEnvironment,
  PASSWORD_POLICY,
  text,
} from "@dsd/shared";
import { like } from "drizzle-orm";
import { z } from "zod";

import { createDb, type Pool } from "./client.js";
import {
  agentBrandMemberships,
  agents,
  auditEvents,
  brands,
} from "./schema/index.js";
import { hashPassword } from "./seed/password.js";

/**
 * The brand a real deployment runs as. Its slug is the one the API and the
 * worker default to (`TICKET_BRAND_SLUG`), and the one the demo seed looks
 * for before it loads anything, so once it exists the seed skips itself.
 */
export const PRODUCTION_BRAND = {
  slug: "dsd",
  name: "DSD",
  ticketPrefix: "DSD",
} as const;

/** Every demo staff account is on this domain, and all share a public password. */
const DEMO_STAFF_DOMAIN = "@dsd.example";

export interface BootstrapSettings {
  /** The brand's sender address: every notification is sent from it. */
  supportEmail: string;
  admin: { email: string; displayName: string; password: string };
}

export type BootstrapResult =
  | { bootstrapped: true; brandId: string; adminId: string }
  | { bootstrapped: false; reason: string };

const bootstrapEnvironment = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BOOTSTRAP_SUPPORT_EMAIL: emailSchema,
  BOOTSTRAP_ADMIN_EMAIL: emailSchema,
  BOOTSTRAP_ADMIN_NAME: text(100),
  BOOTSTRAP_ADMIN_PASSWORD: z
    .string()
    .min(PASSWORD_POLICY.minLength)
    .max(PASSWORD_POLICY.maxLength),
});

/**
 * Reads the bootstrap settings, refusing to go on if any is missing or
 * invalid. The error names the keys, never the values (`ConfigError`).
 */
export function bootstrapSettingsFromEnv(
  source: Record<string, string | undefined>,
): { databaseUrl: string; settings: BootstrapSettings } {
  const env = parseEnvironment(bootstrapEnvironment, source);
  return {
    databaseUrl: env.DATABASE_URL,
    settings: {
      supportEmail: env.BOOTSTRAP_SUPPORT_EMAIL,
      admin: {
        email: env.BOOTSTRAP_ADMIN_EMAIL,
        displayName: env.BOOTSTRAP_ADMIN_NAME,
        password: env.BOOTSTRAP_ADMIN_PASSWORD,
      },
    },
  };
}

/**
 * First run of a real deployment: the brand and one admin, who invites
 * everyone else from the agent app. It replaces the demo seed, whose
 * accounts share a password printed in the README.
 *
 * It runs on every deploy and does nothing once the brand exists. The brand
 * insert is the guard: a concurrent run waits on the slug's unique index and
 * then inserts nothing. Like the seed, it writes no outbox event, so no
 * email is sent: the admin already has a password and needs no invite.
 *
 * A database holding the demo data is refused rather than skipped, so a
 * deployment can't go live with accounts anyone can sign in to.
 */
export async function bootstrapProduction(
  pool: Pool,
  settings: BootstrapSettings,
): Promise<BootstrapResult> {
  // Hashing takes a moment, so it happens before the transaction starts.
  const passwordHash = await hashPassword(settings.admin.password);
  return createDb(pool).transaction(async (tx) => {
    const [brand] = await tx
      .insert(brands)
      .values({ ...PRODUCTION_BRAND, supportEmail: settings.supportEmail })
      .onConflictDoNothing({ target: brands.slug })
      .returning({ id: brands.id });

    if (brand === undefined) {
      const demo = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(like(agents.emailNormalized, `%${DEMO_STAFF_DOMAIN}`))
        .limit(1);
      if (demo.length > 0) {
        throw new Error(
          `the database holds the demo data (staff accounts at ${DEMO_STAFF_DOMAIN.slice(1)}, whose password is public); a deployment must start from an empty database`,
        );
      }
      return {
        bootstrapped: false,
        reason: `brand ${PRODUCTION_BRAND.slug} already exists`,
      };
    }

    const [admin] = await tx
      .insert(agents)
      .values({
        email: settings.admin.email,
        emailNormalized: normalizeEmail(settings.admin.email),
        displayName: settings.admin.displayName,
        role: "admin",
        passwordHash,
      })
      .returning({ id: agents.id });
    if (admin === undefined) throw new Error("admin insert returned nothing");

    await tx
      .insert(agentBrandMemberships)
      .values({ agentId: admin.id, brandId: brand.id });

    const action: AuditAction = "agent.created";
    await tx.insert(auditEvents).values({
      ticketId: null,
      entityType: "agent",
      entityId: admin.id,
      action,
      actorType: "system",
      actorCustomerId: null,
      actorAgentId: null,
      before: null,
      after: { role: "admin" },
      requestId: `bootstrap-${randomUUID()}`,
    });

    return { bootstrapped: true, brandId: brand.id, adminId: admin.id };
  });
}
