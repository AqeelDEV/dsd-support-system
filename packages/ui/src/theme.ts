/*
 * The viewer's theme. "system" follows the operating system's light or dark
 * setting; "light" and "dark" override it. The choice is kept in a cookie
 * rather than local storage so that each app's root layout can render
 * <html data-theme> with it: the first paint is already in the right theme,
 * with no inline script to run before it.
 */

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const THEME_COOKIE = "dsd_theme";

/** The theme a stored value names; anything else, or nothing, is "system". */
export function parseTheme(value: string | undefined): Theme {
  return THEMES.find((theme) => theme === value) ?? "system";
}

/** The data-theme attribute for <html>. None leaves it to the system setting. */
export function themeAttribute(
  cookie: string | undefined,
): "light" | "dark" | undefined {
  const theme = parseTheme(cookie);
  return theme === "system" ? undefined : theme;
}

/**
 * The `document.cookie` assignment that remembers a choice for a year, or
 * forgets it for "system". Script-readable, as it holds nothing secret.
 */
export function themeCookie(theme: Theme, secure: boolean): string {
  const attributes = `Path=/; SameSite=Lax${secure ? "; Secure" : ""}`;
  return theme === "system"
    ? `${THEME_COOKIE}=; Max-Age=0; ${attributes}`
    : `${THEME_COOKIE}=${theme}; Max-Age=31536000; ${attributes}`;
}
