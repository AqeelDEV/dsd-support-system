import { Inject, Injectable } from "@nestjs/common";
import { agents, customers } from "@dsd/db/schema";
import { eq, sql } from "drizzle-orm";

import type { Executor } from "../infrastructure/database.js";
import { DB } from "../infrastructure/tokens.js";

/** The sign-in view of a customer or an agent. */
export interface Account {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string | null;
}

export interface StaffAccount extends Account {
  displayName: string;
  role: (typeof agents.$inferSelect)["role"];
  deactivatedAt: Date | null;
}

/** Reads and updates the identity rows that sign-in needs. */
@Injectable()
export class AccountsRepository {
  constructor(@Inject(DB) private readonly db: Executor) {}

  async customerByEmail(emailNormalized: string): Promise<Account | undefined> {
    const [row] = await this.db
      .select({
        id: customers.id,
        email: customers.email,
        displayName: customers.displayName,
        passwordHash: customers.passwordHash,
      })
      .from(customers)
      .where(eq(customers.emailNormalized, emailNormalized))
      .limit(1);
    return row;
  }

  async agentByEmail(
    emailNormalized: string,
  ): Promise<StaffAccount | undefined> {
    const [row] = await this.db
      .select({
        id: agents.id,
        email: agents.email,
        displayName: agents.displayName,
        passwordHash: agents.passwordHash,
        role: agents.role,
        deactivatedAt: agents.deactivatedAt,
      })
      .from(agents)
      .where(eq(agents.emailNormalized, emailNormalized))
      .limit(1);
    return row;
  }

  /** Records a sign-in, and stores a rehashed password when the old one used outdated parameters. */
  async recordCustomerLogin(
    executor: Executor,
    id: string,
    rehashed?: string,
  ): Promise<void> {
    await executor
      .update(customers)
      .set({
        lastLoginAt: sql`now()`,
        ...(rehashed === undefined ? {} : { passwordHash: rehashed }),
      })
      .where(eq(customers.id, id));
  }

  async recordAgentLogin(
    executor: Executor,
    id: string,
    rehashed?: string,
  ): Promise<void> {
    await executor
      .update(agents)
      .set({
        lastLoginAt: sql`now()`,
        ...(rehashed === undefined ? {} : { passwordHash: rehashed }),
      })
      .where(eq(agents.id, id));
  }
}
