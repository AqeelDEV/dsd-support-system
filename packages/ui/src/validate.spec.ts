import { z } from "zod";
import { describe, expect, it } from "vitest";

import { validateForm } from "./validate";

const schema = z.strictObject({
  email: z.email(),
  subject: z.string().trim().min(1).max(5),
});
const messages = {
  email: "Enter your email address",
  subject: "Add a subject",
};

describe("validateForm", () => {
  it("returns the parsed data when the values pass", () => {
    expect(
      validateForm(schema, { email: "a@b.example", subject: " Hi " }, messages),
    ).toEqual({ data: { email: "a@b.example", subject: "Hi" } });
  });

  it("gives each failing field its own plain message", () => {
    expect(
      validateForm(schema, { email: "nope", subject: "" }, messages).errors,
    ).toEqual(messages);
  });
});
