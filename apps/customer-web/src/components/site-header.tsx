"use client";

import { ok } from "@dsd/api-client";
import {
  Avatar,
  Badge,
  Button,
  buttonVariants,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Skeleton,
  ThemeMenu,
  toast,
} from "@dsd/ui";
import {
  BookOpen,
  Inbox,
  LogIn,
  LogOut,
  Menu,
  Plus,
  Search,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { api } from "@/lib/api";
import { isAccount, useSession, useSetSession } from "@/lib/session";

import { Wordmark } from "./brand";

const navLink =
  "rounded-md px-2.5 py-1.5 text-base font-medium text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:text-foreground";

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const session = useSession();
  const setSession = useSetSession();
  const account = isAccount(session.data) ? session.data : undefined;
  const guest =
    session.data !== undefined &&
    session.data !== null &&
    session.data.guestTicketId !== null;

  const current = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`) ? "page" : undefined;

  const signOut = async () => {
    try {
      await ok(api.POST("/api/v1/auth/customer/logout"));
    } catch {
      // Already signed out on the server, or it can't be reached: forget the session here either way.
    }
    await setSession(null);
    router.push("/");
    toast("You're signed out.");
  };

  const accountName =
    account?.customer.displayName ?? account?.customer.email ?? "";

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-card/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-5xl items-center gap-6 px-4 sm:px-6">
        <Wordmark />
        <nav aria-label="Main" className="hidden items-center gap-1 sm:flex">
          <Link
            href="/help"
            className={navLink}
            aria-current={current("/help")}
          >
            Help centre
          </Link>
          {account === undefined ? (
            <Link
              href="/find-ticket"
              className={navLink}
              aria-current={current("/find-ticket")}
            >
              Find a request
            </Link>
          ) : (
            <Link
              href="/tickets"
              className={navLink}
              aria-current={current("/tickets")}
            >
              My requests
            </Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          {guest ? (
            <Badge tone="info" className="hidden md:inline-flex">
              Opened from your email link
            </Badge>
          ) : null}
          {pathname === "/new" ? null : (
            <Link
              href="/new"
              className={cn(buttonVariants(), "hidden sm:inline-flex")}
            >
              Contact support
            </Link>
          )}
          <ThemeMenu size="icon-lg" />
          {session.isPending ? (
            <Skeleton className="hidden size-8 rounded-full sm:block" />
          ) : account === undefined ? (
            <Link
              href="/sign-in"
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "hidden sm:inline-flex",
              )}
            >
              Sign in
            </Link>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="hidden rounded-full sm:block"
                  aria-label={`Account menu for ${accountName}`}
                >
                  <Avatar name={accountName} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>
                  <span className="block font-medium text-foreground">
                    {account.customer.displayName ?? "Your account"}
                  </span>
                  <span className="block truncate">
                    {account.customer.email}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    router.push("/tickets");
                  }}
                >
                  <Inbox aria-hidden="true" /> My requests
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
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon-lg"
                className="sm:hidden"
                aria-label="Menu"
              >
                <Menu aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-64">
              {account === undefined ? null : (
                <DropdownMenuLabel className="truncate">
                  {account.customer.email}
                </DropdownMenuLabel>
              )}
              <DropdownMenuItem
                onSelect={() => {
                  router.push("/new");
                }}
              >
                <Plus aria-hidden="true" /> Contact support
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  router.push("/help");
                }}
              >
                <BookOpen aria-hidden="true" /> Help centre
              </DropdownMenuItem>
              {account === undefined ? (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      router.push("/find-ticket");
                    }}
                  >
                    <Search aria-hidden="true" /> Find a request
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      router.push("/sign-in");
                    }}
                  >
                    <LogIn aria-hidden="true" /> Sign in
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem
                    onSelect={() => {
                      router.push("/tickets");
                    }}
                  >
                    <Inbox aria-hidden="true" /> My requests
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => {
                      void signOut();
                    }}
                  >
                    <LogOut aria-hidden="true" /> Sign out
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
