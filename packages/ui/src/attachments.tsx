"use client";

import { ATTACHMENT_LIMITS, type Attachment } from "@dsd/shared";
import { FileImage, FileText, Paperclip, X } from "lucide-react";
import { type DragEvent, useId, useRef, useState } from "react";

import { cn } from "./cn";
import { bytes } from "./format";

/*
 * The limits come from the shared constants so a customer hears about a
 * file that's too big before uploading it. The API still checks every
 * file's bytes (ADR-0009): this is a courtesy, not the rule.
 */

const ACCEPT =
  "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,.txt";

export const ATTACHMENT_HINT = `Up to ${ATTACHMENT_LIMITS.maxFiles} files, ${bytes(ATTACHMENT_LIMITS.maxBytes)} each: images, PDF or plain text.`;

/** The files that fit the limits, and a message for any that didn't. */
export function acceptFiles(
  current: readonly File[],
  added: readonly File[],
): { files: File[]; problem: string | undefined } {
  const files = [...current];
  const problems: string[] = [];
  for (const file of added) {
    if (file.size > ATTACHMENT_LIMITS.maxBytes) {
      problems.push(
        `${file.name} is larger than ${bytes(ATTACHMENT_LIMITS.maxBytes)}.`,
      );
    } else if (file.size === 0) {
      problems.push(`${file.name} is empty.`);
    } else if (files.length >= ATTACHMENT_LIMITS.maxFiles) {
      problems.push(
        `You can attach up to ${ATTACHMENT_LIMITS.maxFiles} files.`,
      );
      break;
    } else {
      files.push(file);
    }
  }
  return {
    files,
    problem: problems.length === 0 ? undefined : problems.join(" "),
  };
}

export function AttachmentPicker({
  files,
  onChange,
  disabled = false,
  compact = false,
  error,
}: {
  files: readonly File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  /** The agent composer's single-line version. */
  compact?: boolean;
  error?: string | undefined;
}) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [problem, setProblem] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const message = error ?? problem;

  const add = (added: FileList | null) => {
    if (added === null) return;
    const result = acceptFiles(files, [...added]);
    setProblem(result.problem);
    onChange(result.files);
  };

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) add(event.dataTransfer.files);
  };

  const full = files.length >= ATTACHMENT_LIMITS.maxFiles;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={input}
        type="file"
        multiple
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(event) => {
          add(event.target.files);
          event.target.value = "";
        }}
      />
      {compact ? (
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => input.current?.click()}
          aria-describedby={hintId}
          className="inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <Paperclip aria-hidden="true" className="size-4" />
          Attach
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={onDrop}
          aria-describedby={hintId}
          className={cn(
            "flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-input bg-card px-4 py-3 text-base text-muted-foreground transition-colors hover:border-ring hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60",
            dragging && "border-ring bg-accent text-accent-foreground",
          )}
        >
          <Paperclip aria-hidden="true" className="size-4" />
          <span>
            <span className="font-medium text-foreground">Add files</span> or
            drop them here
          </span>
        </button>
      )}
      <p
        id={hintId}
        className={cn(
          "text-xs",
          message === undefined
            ? "text-muted-foreground"
            : "font-medium text-tone-danger-fg",
          compact && message === undefined && "sr-only",
        )}
        role={message === undefined ? undefined : "alert"}
      >
        {message ?? ATTACHMENT_HINT}
      </p>
      {files.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2" aria-label="Files to send">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-border bg-muted pr-1 pl-2.5 text-sm"
            >
              <FileIcon type={file.type} />
              <span className="truncate">{file.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground tabular">
                {bytes(file.size)}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setProblem(undefined);
                  onChange(files.filter((_, at) => at !== index));
                }}
                className="grid size-6 shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-card hover:text-foreground"
                aria-label={`Remove ${file.name}`}
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FileIcon({ type }: { type: string }) {
  const Icon = type.startsWith("image/") ? FileImage : FileText;
  return (
    <Icon
      aria-hidden="true"
      className="size-4 shrink-0 text-muted-foreground"
    />
  );
}

/**
 * Files on a ticket or message. Each link goes to the app's own `/api`
 * proxy, which checks access and streams the file as a download (ADR-0009).
 */
export function AttachmentList({
  attachments,
  hrefFor,
  className,
}: {
  attachments: readonly Attachment[];
  hrefFor: (attachment: Attachment) => string;
  className?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul
      className={cn("flex flex-wrap gap-2", className)}
      aria-label="Attachments"
    >
      {attachments.map((attachment) => (
        <li key={attachment.id} className="max-w-full">
          <a
            href={hrefFor(attachment)}
            download={attachment.filename}
            className="inline-flex h-8 max-w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 text-sm transition-colors hover:border-border-strong hover:bg-muted"
          >
            <FileIcon type={attachment.contentType} />
            <span className="truncate">{attachment.filename}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular">
              {bytes(attachment.sizeBytes)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
