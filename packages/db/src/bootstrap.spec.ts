import { ConfigError } from "@dsd/shared";
import { describe, expect, it } from "vitest";

import { bootstrapSettingsFromEnv } from "./bootstrap.js";

const PASSWORD = "a-long-enough-admin-password";

const valid = {
  DATABASE_URL: "postgres://dsd_migrator:secret@postgres:5432/dsd",
  BOOTSTRAP_SUPPORT_EMAIL: "info@support.example",
  BOOTSTRAP_ADMIN_EMAIL: "first.admin@support.example",
  BOOTSTRAP_ADMIN_NAME: "First Admin",
  BOOTSTRAP_ADMIN_PASSWORD: PASSWORD,
};

function problemsWith(source: Record<string, string | undefined>): string {
  try {
    bootstrapSettingsFromEnv(source);
  } catch (error) {
    if (error instanceof ConfigError) return error.message;
    throw error;
  }
  throw new Error("the settings were accepted");
}

describe("bootstrapSettingsFromEnv", () => {
  it("reads the brand's sender and the first admin", () => {
    expect(bootstrapSettingsFromEnv(valid)).toEqual({
      databaseUrl: valid.DATABASE_URL,
      settings: {
        supportEmail: "info@support.example",
        admin: {
          email: "first.admin@support.example",
          displayName: "First Admin",
          password: PASSWORD,
        },
      },
    });
  });

  it.each(Object.keys(valid))("refuses to run without %s", (key) => {
    expect(problemsWith({ ...valid, [key]: undefined })).toContain(
      `${key}: is required`,
    );
  });

  it("names every missing setting at once", () => {
    const message = problemsWith({});
    for (const key of Object.keys(valid)) expect(message).toContain(key);
  });

  it("refuses a password shorter than the password policy, without echoing it", () => {
    const message = problemsWith({
      ...valid,
      BOOTSTRAP_ADMIN_PASSWORD: "short-pw",
    });
    expect(message).toContain("BOOTSTRAP_ADMIN_PASSWORD");
    expect(message).not.toContain("short-pw");
  });

  it("refuses addresses that aren't email addresses, and a blank name", () => {
    const message = problemsWith({
      ...valid,
      BOOTSTRAP_SUPPORT_EMAIL: "info",
      BOOTSTRAP_ADMIN_EMAIL: "admin@",
      BOOTSTRAP_ADMIN_NAME: "   ",
    });
    expect(message).toContain("BOOTSTRAP_SUPPORT_EMAIL");
    expect(message).toContain("BOOTSTRAP_ADMIN_EMAIL");
    expect(message).toContain("BOOTSTRAP_ADMIN_NAME");
  });

  it("never puts a value in its error, even the database password", () => {
    const message = problemsWith({ ...valid, BOOTSTRAP_ADMIN_NAME: "" });
    for (const value of Object.values(valid)) {
      expect(message).not.toContain(value);
    }
    expect(message).not.toContain("secret");
  });
});
