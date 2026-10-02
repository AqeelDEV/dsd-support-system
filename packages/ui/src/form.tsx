"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { type ComponentProps, type ReactNode, useId, useState } from "react";

import { cn } from "./cn";

const controlVariants = cva(
  "w-full min-w-0 rounded-md border border-input bg-card text-foreground transition-[border-color,box-shadow] placeholder:text-subtle hover:border-border-strong focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-70 aria-invalid:border-tone-danger aria-invalid:focus-visible:ring-tone-danger/20",
  {
    variants: {
      size: {
        sm: "h-8 px-2.5 text-sm",
        md: "h-9 px-3 text-base",
        lg: "h-11 px-3.5 text-md",
      },
    },
    defaultVariants: { size: "md" },
  },
);

type ControlSize = VariantProps<typeof controlVariants>["size"];

export type InputProps = Omit<ComponentProps<"input">, "size"> & {
  size?: ControlSize;
};

export function Input({ className, size, ...props }: InputProps) {
  return (
    <input className={cn(controlVariants({ size }), className)} {...props} />
  );
}

/** A password field with a show/hide toggle, so people can check what they typed. */
export function PasswordInput({ className, size, ...props }: InputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className={cn("relative block", className)}>
      <Input
        {...props}
        size={size}
        type={visible ? "text" : "password"}
        className="pr-11"
      />
      <button
        type="button"
        onClick={() => {
          setVisible((value) => !value);
        }}
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
        className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
      >
        {visible ? (
          <EyeOff aria-hidden="true" className="size-4" />
        ) : (
          <Eye aria-hidden="true" className="size-4" />
        )}
      </button>
    </span>
  );
}

export type TextareaProps = ComponentProps<"textarea"> & { size?: ControlSize };

export function Textarea({ className, size, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        controlVariants({ size }),
        "h-auto min-h-24 resize-y py-2 leading-relaxed",
        className,
      )}
      {...props}
    />
  );
}

export type SelectProps = Omit<ComponentProps<"select">, "size"> & {
  size?: ControlSize;
};

/** A native select, styled: keyboard, screen-reader and mobile behaviour come from the platform. */
export function Select({ className, size, children, ...props }: SelectProps) {
  return (
    <span className={cn("relative block", className)}>
      <select
        className={cn(
          controlVariants({ size }),
          "cursor-pointer appearance-none pr-8",
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

export function Label({ className, ...props }: ComponentProps<"label">) {
  return (
    // The caller passes htmlFor or wraps the control; jsx-a11y can't see it here.
    // eslint-disable-next-line jsx-a11y/label-has-associated-control
    <label
      className={cn("text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export interface ControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
}

export interface FieldProps {
  label: ReactNode;
  /** Shown under the control while there is no error. */
  hint?: ReactNode;
  error?: string | undefined;
  /** Shown after the label, e.g. "Optional" or a character count. */
  aside?: ReactNode;
  className?: string;
  /** Receives the id and ARIA wiring for the control. */
  children: (control: ControlProps) => ReactNode;
}

/**
 * A labelled form field: label, control, then hint or error. The error is
 * tied to the control with `aria-describedby` and `aria-invalid`, so a
 * screen reader announces it with the field (UI-2).
 */
export function Field({
  label,
  hint,
  error,
  aside,
  className,
  children,
}: FieldProps) {
  const id = useId();
  const messageId = `${id}-message`;
  const message = error ?? hint;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id} className="text-sm text-foreground">
          {label}
        </Label>
        {aside === undefined ? null : (
          <span className="text-xs text-muted-foreground tabular">{aside}</span>
        )}
      </div>
      {children({
        id,
        ...(message === undefined ? {} : { "aria-describedby": messageId }),
        ...(error === undefined ? {} : { "aria-invalid": true }),
      })}
      {message === undefined ? null : (
        <p
          id={messageId}
          className={cn(
            "text-xs",
            error === undefined
              ? "text-muted-foreground"
              : "font-medium text-tone-danger-fg",
          )}
        >
          {message}
        </p>
      )}
    </div>
  );
}
