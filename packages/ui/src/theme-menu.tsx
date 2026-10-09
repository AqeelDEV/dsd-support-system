"use client";

import { type LucideIcon, Monitor, Moon, Sun, SunMoon } from "lucide-react";
import { useSyncExternalStore } from "react";

import { Button, type ButtonProps } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./overlays";
import { parseTheme, type Theme, themeCookie } from "./theme";

const OPTIONS: readonly { theme: Theme; label: string; icon: LucideIcon }[] = [
  { theme: "system", label: "System", icon: Monitor },
  { theme: "light", label: "Light", icon: Sun },
  { theme: "dark", label: "Dark", icon: Moon },
];

/*
 * The attribute on <html> is the page's record of the choice: the server
 * set it from the cookie, and choosing changes both. Every theme menu on the
 * page watches it, so two of them never disagree.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => {
    observer.disconnect();
  };
}

const currentTheme = (): Theme =>
  parseTheme(document.documentElement.dataset.theme);

function choose(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  document.cookie = themeCookie(theme, window.location.protocol === "https:");
}

/** An icon button that opens the theme choices: the system's, light or dark. */
export function ThemeMenu({
  variant = "ghost",
  size = "icon",
  className,
}: Pick<ButtonProps, "variant" | "size" | "className">) {
  // The menu's items render only once it opens, on the client, so the
  // server's placeholder never reaches the screen.
  const theme = useSyncExternalStore(
    subscribe,
    currentTheme,
    (): Theme => "system",
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          className={className}
          aria-label="Theme"
        >
          <SunMoon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-40">
        <DropdownMenuLabel>Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => {
            choose(parseTheme(value));
          }}
        >
          {OPTIONS.map(({ theme: option, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={option} value={option}>
              <Icon aria-hidden="true" /> {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
