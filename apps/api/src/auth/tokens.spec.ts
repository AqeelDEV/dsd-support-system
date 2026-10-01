import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateToken, hashToken } from "./tokens.js";

describe("tokens", () => {
  it("are 32 random bytes in base64url, safe in cookies and URL fragments", () => {
    const token = generateToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  it("never repeat", () => {
    const tokens = new Set(Array.from({ length: 1000 }, generateToken));
    expect(tokens.size).toBe(1000);
  });

  it("are stored as their SHA-256, never as themselves", () => {
    const token = generateToken();
    const hash = hashToken(token);
    expect(hash).toEqual(createHash("sha256").update(token).digest());
    expect(hash.toString("utf8")).not.toContain(token);
    expect(hash.toString("base64url")).not.toBe(token);
  });
});
