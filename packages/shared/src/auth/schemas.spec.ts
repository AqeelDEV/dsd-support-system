import { describe, expect, it } from "vitest";

import { PASSWORD_POLICY } from "../domain/password.js";
import {
  guestAccessRequestSchema,
  inviteCompleteRequestSchema,
  loginRequestSchema,
  signupCompleteRequestSchema,
} from "./schemas.js";

const TOKEN = "A".repeat(43);

describe("auth request schemas", () => {
  it("rejects fields an endpoint doesn't expect (mass assignment)", () => {
    const result = loginRequestSchema.safeParse({
      email: "ana@example.com",
      password: "whatever",
      role: "admin",
    });
    expect(result.success).toBe(false);
  });

  it("caps the sign-in password so a huge one can't burn CPU", () => {
    const tooLong = "x".repeat(PASSWORD_POLICY.maxLength + 1);
    expect(
      loginRequestSchema.safeParse({
        email: "ana@example.com",
        password: tooLong,
      }).success,
    ).toBe(false);
  });

  it.each([
    ["one under the minimum", PASSWORD_POLICY.minLength - 1, false],
    ["the minimum", PASSWORD_POLICY.minLength, true],
    ["the maximum", PASSWORD_POLICY.maxLength, true],
    ["one over the maximum", PASSWORD_POLICY.maxLength + 1, false],
  ])("judges a new password of %s by length alone", (_, length, valid) => {
    const password = "a".repeat(length);
    expect(
      inviteCompleteRequestSchema.safeParse({ token: TOKEN, password }).success,
    ).toBe(valid);
  });

  it("accepts only tokens shaped like the emailed ones", () => {
    const parse = (token: string) =>
      signupCompleteRequestSchema.safeParse({
        token,
        displayName: "Ana",
        password: "a long enough passphrase",
      }).success;
    expect(parse(TOKEN)).toBe(true);
    expect(parse(`${TOKEN}=`)).toBe(false);
    expect(parse("A".repeat(42))).toBe(false);
  });

  it("trims a display name and refuses a blank one", () => {
    const parse = (displayName: string) =>
      signupCompleteRequestSchema.safeParse({
        token: TOKEN,
        displayName,
        password: "a long enough passphrase",
      });
    expect(parse("  Ana  ").data?.displayName).toBe("Ana");
    expect(parse("   ").success).toBe(false);
  });

  it("takes ticket references in their printed form", () => {
    const parse = (reference: string) =>
      guestAccessRequestSchema.safeParse({
        email: "ana@example.com",
        reference,
      }).success;
    expect(parse("DSD-000123")).toBe(true);
    expect(parse("dsd-1234567")).toBe(true);
    expect(parse("DSD-12")).toBe(false);
    expect(parse("123")).toBe(false);
  });
});
