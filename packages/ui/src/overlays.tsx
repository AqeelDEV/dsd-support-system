"use client";

import { X } from "lucide-react";
import {
  Dialog as DialogPrimitive,
  DropdownMenu as MenuPrimitive,
  Popover as PopoverPrimitive,
  Tabs as TabsPrimitive,
  Tooltip as TooltipPrimitive,
} from "radix-ui";
import { type ComponentProps, type ReactNode, useRef } from "react";
import { Toaster as Sonner, toast } from "sonner";

import { cn } from "./cn";

/*
 * Overlays are the only surfaces that cast a shadow (ADR-0013). Focus
 * trapping, Escape to close and ARIA roles come from Radix; so does focus
 * return, but only for a dialog opened through a DialogTrigger, which is
 * why DialogContent handles it itself (below).
 */

const overlaySurface =
  "border border-border bg-card text-card-foreground shadow-overlay";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({
  title,
  description,
  children,
  className,
  footer,
  returnFocusTo,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /**
   * Where focus goes when the dialog closes, for a dialog opened from a
   * menu item, which is gone by then. Otherwise it goes back to whatever
   * had focus when the dialog opened.
   */
  returnFocusTo?: () => HTMLElement | null | undefined;
}) {
  // Radix returns focus to the DialogTrigger when a dialog closes; a dialog
  // opened from state (a menu item, a shortcut) has none, and focus fell to
  // the page. So remember what had focus as the dialog opened, and give it
  // back on close if it is still on the page (WCAG 2.4.3, found in the
  // Phase 10 accessibility pass).
  const returnTo = useRef<HTMLElement | null>(null);
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/25 backdrop-blur-[1px] animate-fade-in" />
      <DialogPrimitive.Content
        onOpenAutoFocus={() => {
          returnTo.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = returnFocusTo?.() ?? returnTo.current;
          if (target?.isConnected === true && target !== document.body) {
            event.preventDefault();
            target.focus();
          }
        }}
        className={cn(
          overlaySurface,
          "fixed top-1/2 left-1/2 z-50 flex animate-pop-in max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl focus-visible:outline-none",
          className,
        )}
        {...(description === undefined
          ? { "aria-describedby": undefined }
          : {})}
      >
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div>
            <DialogPrimitive.Title className="text-lg font-semibold">
              {title}
            </DialogPrimitive.Title>
            {description === undefined ? null : (
              <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close
            className="-mt-1 -mr-1 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X aria-hidden="true" className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer === undefined ? null : (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** A panel that slides in from the left: the agent app's navigation on a phone. */
export function SheetContent({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/25" />
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className={cn(
          overlaySurface,
          "fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col rounded-none border-y-0 border-l-0 focus-visible:outline-none",
        )}
      >
        <DialogPrimitive.Title className="sr-only">
          {title}
        </DialogPrimitive.Title>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * Menus are not modal: Radix's modal mode hides the rest of the page from
 * assistive technology while leaving it focusable (the skip link, for one),
 * which axe reports as aria-hidden-focus. A menu button doesn't need to trap
 * anyone (WAI-ARIA APG): Escape, a click outside or Tab closes it.
 */
export function DropdownMenu(props: ComponentProps<typeof MenuPrimitive.Root>) {
  return <MenuPrimitive.Root modal={false} {...props} />;
}
export const DropdownMenuTrigger = MenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  align = "end",
  ...props
}: ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          overlaySurface,
          "z-50 min-w-48 animate-pop-in rounded-lg p-1 text-sm",
          className,
        )}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentProps<typeof MenuPrimitive.Item> & { destructive?: boolean }) {
  return (
    <MenuPrimitive.Item
      className={cn(
        "flex h-8 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground",
        destructive && "text-tone-danger-fg [&_svg]:text-tone-danger-fg",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: ComponentProps<typeof MenuPrimitive.Label>) {
  return (
    <MenuPrimitive.Label
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <MenuPrimitive.Separator className="my-1 h-px bg-border" />;
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({
  className,
  align = "start",
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={6}
        className={cn(
          overlaySurface,
          "z-50 w-72 animate-pop-in rounded-lg p-1",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export const Tabs = TabsPrimitive.Root;
export const TabsContent = TabsPrimitive.Content;

/** Underlined tabs: the selection carries the accent, the rest stays quiet. */
export function TabsList({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn("flex gap-4 border-b border-border", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "-mb-px inline-flex h-9 items-center gap-1.5 border-b-2 border-transparent text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({
  content,
  children,
  side = "top",
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <TooltipPrimitive.Root delayDuration={300}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-1.5 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-overlay"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/** Toasts for the outcome of an action; errors that block the user stay in the page instead. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      toastOptions={{
        classNames: {
          toast: cn(
            overlaySurface,
            "!rounded-lg !border-border !bg-card !text-card-foreground !text-sm",
          ),
          description: "!text-muted-foreground",
        },
      }}
    />
  );
}

export { toast };
