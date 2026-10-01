import { Injectable } from "@nestjs/common";
import { customers } from "@dsd/db/schema";
import { eq } from "drizzle-orm";

import type { Executor } from "../../infrastructure/database.js";

/**
 * Customer identities. A customer is one row per normalised email, whether
 * they registered or only ever raised tickets as a guest (DATA_MODEL.md).
 */
@Injectable()
export class CustomersRepository {
  /**
   * The customer for `emailNormalized`, created without a password if there
   * isn't one yet. Guest tickets, sign-up and registered submissions all
   * land on this one row, which is why earlier guest tickets appear once
   * the account is registered. Safe under concurrent calls.
   */
  async findOrCreate(
    executor: Executor,
    email: string,
    emailNormalized: string,
  ): Promise<string> {
    const [created] = await executor
      .insert(customers)
      .values({ email, emailNormalized })
      .onConflictDoNothing({ target: customers.emailNormalized })
      .returning({ id: customers.id });
    if (created !== undefined) return created.id;
    const [existing] = await executor
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.emailNormalized, emailNormalized));
    if (existing === undefined) {
      throw new Error("customer vanished between insert and select");
    }
    return existing.id;
  }
}
