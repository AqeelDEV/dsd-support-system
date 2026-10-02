import type { Permission } from "@dsd/shared";

export interface NavItem {
  href: string;
  label: string;
  /** Shown only to people whose `/me` permissions include this. */
  permission: Permission;
  icon: "queue" | "kb" | "canned" | "reports" | "team";
}

/**
 * The agent app's sections and the permission each needs to be shown. The
 * permission names come from the API's map (ADR-0004); hiding a link is a
 * convenience, the API refuses the routes behind it all the same.
 */
export const NAV: readonly NavItem[] = [
  {
    href: "/queue",
    label: "Queue",
    permission: "ticket:read:any",
    icon: "queue",
  },
  { href: "/kb", label: "Knowledge base", permission: "kb:read", icon: "kb" },
  {
    href: "/canned",
    label: "Canned responses",
    permission: "canned:use",
    icon: "canned",
  },
  {
    href: "/reports",
    label: "Reports",
    permission: "report:view",
    icon: "reports",
  },
  { href: "/team", label: "Team", permission: "user:read", icon: "team" },
];

export function visibleNav(permissions: readonly Permission[]): NavItem[] {
  const held = new Set(permissions);
  return NAV.filter((item) => held.has(item.permission));
}
