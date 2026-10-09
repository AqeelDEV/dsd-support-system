"use client";

import { ok } from "@dsd/api-client";
import {
  Avatar,
  Badge,
  Button,
  cn,
  describeProblem,
  Dialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  ErrorState,
  Kbd,
  ROLE_LABELS,
  SheetContent,
  Spinner,
  ThemeMenu,
  toast,
} from "@dsd/ui";
import {
  BarChart3,
  BookOpen,
  ChevronsUpDown,
  Inbox,
  Keyboard,
  LogOut,
  type LucideIcon,
  Menu,
  MessageSquareText,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { api } from "@/lib/api";
import { type NavItem, visibleNav } from "@/lib/nav";
import { useSession, useSetSession } from "@/lib/session";

import { Wordmark } from "./brand";
import { isTyping, ShortcutsDialog } from "./shortcuts";

const ICONS: Record<NavItem["icon"], LucideIcon> = {
  queue: Inbox,
  kb: BookOpen,
  canned: MessageSquareText,
  reports: BarChart3,
  team: Users,
};

/**
 * The signed-in workspace: a sidebar on desktop, a menu sheet on phones.
 * The sections shown come from the permissions `/me` reports; the API
 * refuses the routes behind hidden ones all the same.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const signedOut = session.isSuccess && session.data === null;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "?" && !isTyping(event.target)) {
        event.preventDefault();
        setShortcuts(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    if (signedOut)
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
  }, [signedOut, router, pathname]);

  if (session.isError) {
    const message = describeProblem(session.error);
    return (
      <div className="grid min-h-dvh place-items-center p-4">
        <ErrorState {...message} onRetry={() => void session.refetch()} />
      </div>
    );
  }
  if (session.isPending || session.data === null) {
    return (
      <div
        role="status"
        className="grid min-h-dvh place-items-center text-muted-foreground"
      >
        <Spinner className="size-5" />
        <span className="sr-only">Loading</span>
      </div>
    );
  }

  const me = session.data;
  const nav = visibleNav(me.permissions);

  return (
    <div className="flex min-h-dvh">
      <aside
        aria-label="Sections"
        className="hidden w-56 shrink-0 border-r border-border bg-card lg:block"
      >
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="flex h-12 items-center border-b border-border px-4">
            <Wordmark />
          </div>
          <Nav items={nav} pathname={pathname} />
          <div className="mt-auto flex items-center gap-1 border-t border-border p-2">
            <div className="min-w-0 flex-1">
              <UserMenu
                onShortcuts={() => {
                  setShortcuts(true);
                }}
              />
            </div>
            <ThemeMenu />
          </div>
        </div>
      </aside>
      <ShortcutsDialog open={shortcuts} onOpenChange={setShortcuts} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-card px-3 lg:hidden">
          <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation"
              onClick={() => {
                setMenuOpen(true);
              }}
            >
              <Menu aria-hidden="true" />
            </Button>
            <SheetContent title="Navigation">
              <div className="flex h-12 items-center border-b border-border px-4">
                <Wordmark />
              </div>
              <Nav
                items={nav}
                pathname={pathname}
                onNavigate={() => {
                  setMenuOpen(false);
                }}
              />
              <div className="mt-auto border-t border-border p-2">
                <UserMenu
                  onShortcuts={() => {
                    setMenuOpen(false);
                    setShortcuts(true);
                  }}
                />
              </div>
            </SheetContent>
          </Dialog>
          <Wordmark />
          <ThemeMenu className="ml-auto" />
        </div>
        <main id="main" className="flex min-w-0 flex-1 flex-col">
          {children}
        </main>
      </div>
    </div>
  );
}

function Nav({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly NavItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-0.5 p-2">
      {items.map((item) => {
        const Icon = ICONS[item.icon];
        const current =
          pathname === item.href ||
          pathname.startsWith(`${item.href}/`) ||
          (item.href === "/queue" &&
            (pathname.startsWith("/tickets/") ||
              pathname.startsWith("/customers/")));
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm font-medium transition-colors",
              current
                ? "bg-accent text-accent-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon aria-hidden="true" className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ onShortcuts }: { onShortcuts: () => void }) {
  const session = useSession();
  const setSession = useSetSession();
  const router = useRouter();
  const me = session.data;
  if (me === null || me === undefined) return null;

  const signOut = async () => {
    try {
      await ok(api.POST("/api/v1/auth/staff/logout"));
    } catch {
      // Already signed out on the server, or it can't be reached: forget the session here either way.
    }
    await setSession(null);
    router.replace("/sign-in");
    toast("You're signed out.");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-muted"
          aria-label={`Account menu for ${me.agent.displayName}`}
        >
          <Avatar name={me.agent.displayName} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">
              {me.agent.displayName}
            </span>
            <span className="block text-xs text-muted-foreground">
              {ROLE_LABELS[me.agent.role]}
            </span>
          </span>
          <ChevronsUpDown aria-hidden="true" className="size-4 text-subtle" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-60">
        <DropdownMenuLabel>
          <span className="block truncate">{me.agent.email}</span>
          <Badge className="mt-1.5">{ROLE_LABELS[me.agent.role]}</Badge>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onShortcuts}>
          <Keyboard aria-hidden="true" /> Keyboard shortcuts
          <Kbd className="ml-auto">?</Kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void signOut();
          }}
        >
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
