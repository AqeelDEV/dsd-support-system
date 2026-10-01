import type { TicketStatus } from "@dsd/shared";

import type { RenderedNotification } from "./channel.js";

/*
 * Notification templates (FR-5; ADR-0005, section 7). Each is a typed
 * function from its data to a subject, a plain-text body and an HTML body.
 * Every value is escaped before it goes into HTML, and no template takes
 * HTML from anyone. The only message text a template ever carries is an
 * agent's public reply; there is no field an internal note could arrive
 * in.
 */

/** Where a ticket link leads: the signed-in ticket page, or a fresh guest link. */
export interface TicketLink {
  url: string;
  /** `account`: the customer signs in; `guest`: the link itself opens the ticket. */
  kind: "account" | "guest";
}

interface TicketFacts {
  brandName: string;
  reference: string;
  subject: string;
  link: TicketLink;
}

export interface TemplateData {
  ticketReceived: TicketFacts;
  agentReply: TicketFacts & {
    agentName: string;
    reply: string;
    /** The status the reply moved the ticket to, if it did. */
    newStatus: TicketStatus | null;
  };
  statusChanged: TicketFacts & { status: TicketStatus };
  guestLink: TicketFacts;
  signupVerify: { brandName: string; link: string };
  signupExistingAccount: {
    brandName: string;
    signInLink: string;
    resetLink: string;
  };
  passwordReset: { brandName: string; link: string };
  passwordResetNoAccount: { brandName: string; signupLink: string };
  agentInvite: { brandName: string; agentName: string; link: string };
}

export type TemplateName = keyof TemplateData;

/** Escapes text for HTML element content and attribute values. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Subjects are one line: a value with a line break can't add a header. */
const oneLine = (value: string) => value.replace(/[\r\n]+/g, " ").trim();

/** A block of the email: a paragraph, a quoted reply, or a button. */
type Block =
  { paragraph: string } | { quote: string } | { button: string; url: string };

function render(
  subject: string,
  blocks: readonly Block[],
  footer: string,
): RenderedNotification {
  const text = [
    ...blocks.map((block) =>
      "paragraph" in block
        ? block.paragraph
        : "quote" in block
          ? block.quote
              .split("\n")
              .map((line) => `> ${line}`)
              .join("\n")
          : `${block.button}: ${block.url}`,
    ),
    "--",
    footer,
  ].join("\n\n");

  const html = [
    '<!doctype html><html lang="en"><body style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2933">',
    ...blocks.map((block) => {
      if ("paragraph" in block) return `<p>${escapeHtml(block.paragraph)}</p>`;
      if ("quote" in block) {
        const lines = escapeHtml(block.quote).replace(/\r?\n/g, "<br>");
        return `<blockquote style="margin:16px 0;padding:8px 16px;border-left:3px solid #cbd2d9">${lines}</blockquote>`;
      }
      return `<p><a href="${escapeHtml(block.url)}" style="display:inline-block;padding:10px 18px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(block.button)}</a></p><p style="font-size:13px;color:#52606d">Or open this link: ${escapeHtml(block.url)}</p>`;
    }),
    `<hr style="border:none;border-top:1px solid #e4e7eb"><p style="font-size:13px;color:#52606d">${escapeHtml(footer)}</p>`,
    "</body></html>",
  ].join("");

  return { subject: oneLine(subject), text, html };
}

/** Short forms, for subjects. */
const STATUS_HEADLINES: Readonly<Record<TicketStatus, string>> = {
  open: "is open again",
  pending_customer: "is waiting for your reply",
  resolved: "has been resolved",
  closed: "has been closed",
};

const STATUS_PHRASES: Readonly<Record<TicketStatus, string>> = {
  open: "is open again, and we're working on it",
  pending_customer: "is waiting for your reply",
  resolved:
    "has been resolved. If anything is still wrong, just reply and it reopens",
  closed: "has been closed",
};

function ticketButton(link: TicketLink): Block {
  return {
    button:
      link.kind === "guest"
        ? "View your ticket"
        : "Sign in to view your ticket",
    url: link.url,
  };
}

function ticketFooter(facts: TicketFacts): string {
  return facts.link.kind === "guest"
    ? `${facts.brandName} Support. The link opens this ticket only and works for 7 days; a newer email always has a fresh one. Don't forward this email: anyone with the link can read the ticket.`
    : `${facts.brandName} Support. Sign in with your account to see all your tickets.`;
}

export const TEMPLATES: {
  readonly [Name in TemplateName]: (
    data: TemplateData[Name],
  ) => RenderedNotification;
} = {
  ticketReceived: (data) =>
    render(
      `[${data.reference}] We've received your request`,
      [
        {
          paragraph: `Thanks for contacting ${data.brandName} Support. We've received your request "${data.subject}" and its reference is ${data.reference}.`,
        },
        { paragraph: "An agent will reply here as soon as they can." },
        ticketButton(data.link),
      ],
      ticketFooter(data),
    ),

  agentReply: (data) =>
    render(
      `[${data.reference}] New reply: ${data.subject}`,
      [
        {
          paragraph: `${data.agentName} replied to your request ${data.reference}:`,
        },
        { quote: data.reply },
        ...(data.newStatus === null
          ? []
          : [
              {
                paragraph: `Your ticket ${STATUS_PHRASES[data.newStatus]}.`,
              },
            ]),
        ticketButton(data.link),
      ],
      ticketFooter(data),
    ),

  statusChanged: (data) =>
    render(
      `[${data.reference}] Your ticket ${STATUS_HEADLINES[data.status]}`,
      [
        {
          paragraph: `Your request "${data.subject}" (${data.reference}) ${STATUS_PHRASES[data.status]}.`,
        },
        ticketButton(data.link),
      ],
      ticketFooter(data),
    ),

  guestLink: (data) =>
    render(
      `[${data.reference}] Your link to this ticket`,
      [
        {
          paragraph: `Here is a fresh link to your request "${data.subject}" (${data.reference}).`,
        },
        ticketButton(data.link),
      ],
      ticketFooter(data),
    ),

  signupVerify: (data) =>
    render(
      `Finish creating your ${data.brandName} account`,
      [
        {
          paragraph:
            "Someone, hopefully you, asked to create an account with this email address. Use the link to choose your password. It works once and lasts 24 hours.",
        },
        { button: "Choose your password", url: data.link },
        { paragraph: "If it wasn't you, ignore this email: nothing changes." },
      ],
      `${data.brandName} Support`,
    ),

  signupExistingAccount: (data) =>
    render(
      `You already have a ${data.brandName} account`,
      [
        {
          paragraph:
            "Someone, hopefully you, asked to create an account with this email address, but it already has one. Sign in instead, or reset your password if you've forgotten it.",
        },
        { button: "Sign in", url: data.signInLink },
        { button: "Reset your password", url: data.resetLink },
      ],
      `${data.brandName} Support`,
    ),

  passwordReset: (data) =>
    render(
      `Reset your ${data.brandName} password`,
      [
        {
          paragraph:
            "Use the link to choose a new password. It works once and lasts an hour, and choosing a password signs you out everywhere else.",
        },
        { button: "Choose a new password", url: data.link },
        {
          paragraph:
            "If you didn't ask for this, ignore this email: your password stays as it is.",
        },
      ],
      `${data.brandName} Support`,
    ),

  passwordResetNoAccount: (data) =>
    render(
      `About your ${data.brandName} password`,
      [
        {
          paragraph:
            "Someone asked to reset the password for this email address, but there's no password on it yet: you've contacted us without an account. You can create one with this address.",
        },
        { button: "Create an account", url: data.signupLink },
      ],
      `${data.brandName} Support`,
    ),

  agentInvite: (data) =>
    render(
      `You've been invited to ${data.brandName} Support`,
      [
        {
          paragraph: `Hi ${data.agentName}, you've been invited to the ${data.brandName} support team. Use the link to choose your password. It works once and lasts 72 hours.`,
        },
        { button: "Choose your password", url: data.link },
      ],
      `${data.brandName} Support`,
    ),
};

/** Renders `template` with its data; the types keep the two matched. */
export function renderTemplate<Name extends TemplateName>(
  template: Name,
  data: TemplateData[Name],
): RenderedNotification {
  return TEMPLATES[template](data);
}
