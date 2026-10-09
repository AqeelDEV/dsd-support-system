import { describe, expect, it } from "vitest";

import { parseTheme, THEMES, themeAttribute, themeCookie } from "./theme";

describe("parseTheme", () => {
  it.each(THEMES)("reads %s", (theme) => {
    expect(parseTheme(theme)).toBe(theme);
  });

  it.each([undefined, "", "Dark", "blue", "dark; Path=/"])(
    "treats %s as the system's",
    (value) => {
      expect(parseTheme(value)).toBe("system");
    },
  );
});

describe("themeAttribute", () => {
  it("sets the attribute only for a chosen theme", () => {
    expect(themeAttribute("light")).toBe("light");
    expect(themeAttribute("dark")).toBe("dark");
    expect(themeAttribute("system")).toBeUndefined();
    expect(themeAttribute(undefined)).toBeUndefined();
    expect(themeAttribute("<script>")).toBeUndefined();
  });
});

describe("themeCookie", () => {
  it("remembers a chosen theme for a year, site-wide", () => {
    expect(themeCookie("dark", false)).toBe(
      "dsd_theme=dark; Max-Age=31536000; Path=/; SameSite=Lax",
    );
  });

  it("is Secure over HTTPS", () => {
    expect(themeCookie("light", true)).toBe(
      "dsd_theme=light; Max-Age=31536000; Path=/; SameSite=Lax; Secure",
    );
  });

  it("forgets the choice for the system's theme", () => {
    expect(themeCookie("system", false)).toBe(
      "dsd_theme=; Max-Age=0; Path=/; SameSite=Lax",
    );
  });
});
