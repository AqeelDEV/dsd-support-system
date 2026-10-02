import { describe, expect, it } from "vitest";

import { bytes, duration, relativeTime } from "./format";

describe("format", () => {
  it("relativeTime", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(relativeTime("2026-10-02T11:59:50Z", now)).toBe("just now");
    expect(relativeTime("2026-10-02T11:55:00Z", now)).toBe("5 minutes ago");
    expect(relativeTime("2026-10-02T09:00:00Z", now)).toBe("3 hours ago");
    expect(relativeTime("2026-10-01T12:00:00Z", now)).toBe("yesterday");
  });

  it("bytes", () => {
    expect(bytes(1)).toBe("1 byte");
    expect(bytes(2048)).toBe("2 KB");
    expect(bytes(10 * 1024 * 1024)).toBe("10 MB");
    expect(bytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  it("duration", () => {
    expect(duration(42)).toBe("42s");
    expect(duration(12 * 60)).toBe("12m");
    expect(duration(3 * 3600 + 20 * 60)).toBe("3h 20m");
    expect(duration(2 * 86400 + 4 * 3600)).toBe("2d 4h");
  });
});
