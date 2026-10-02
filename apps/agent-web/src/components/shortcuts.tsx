"use client";

import { Dialog, DialogContent, Kbd } from "@dsd/ui";
import { Fragment } from "react";

/** Whether a key press belongs to a text field rather than to a shortcut. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
}

const GROUPS: { title: string; keys: { keys: string[]; label: string }[] }[] = [
  {
    title: "Queue",
    keys: [
      { keys: ["j"], label: "Next ticket" },
      { keys: ["k"], label: "Previous ticket" },
      { keys: ["Enter"], label: "Open the selected ticket" },
    ],
  },
  {
    title: "Ticket",
    keys: [
      { keys: ["r"], label: "Write a reply" },
      { keys: ["n"], label: "Write an internal note" },
      { keys: ["Ctrl", "Enter"], label: "Send" },
      { keys: ["Esc"], label: "Leave the composer" },
    ],
  },
  { title: "Anywhere", keys: [{ keys: ["?"], label: "Show these shortcuts" }] },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Keyboard shortcuts">
        <div className="flex flex-col gap-5">
          {GROUPS.map((group) => (
            <section key={group.title}>
              <h3 className="text-xs font-medium text-muted-foreground">
                {group.title}
              </h3>
              <dl className="mt-2 divide-y divide-border rounded-md border border-border">
                {group.keys.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex items-center justify-between gap-4 px-3 py-2"
                  >
                    <dt className="text-sm">{shortcut.label}</dt>
                    <dd className="flex items-center gap-1">
                      {shortcut.keys.map((key, index) => (
                        <Fragment key={key}>
                          {index > 0 ? (
                            <span className="text-xs text-subtle">+</span>
                          ) : null}
                          <Kbd>{key}</Kbd>
                        </Fragment>
                      ))}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
