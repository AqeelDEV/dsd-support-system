import type { CatalogArticle } from "../kb-catalog.js";

/** Signing in, sign-up, guest requests and account changes. */
export const ACCOUNT_ARTICLES: readonly CatalogArticle[] = [
  {
    category: "accounts",
    slug: "reset-your-password",
    title: "Reset your password",
    summary:
      "Choose a new password with a link we email you. The link works once and lasts an hour.",
    tags: ["password", "sign-in"],
    published: true,
    body: `## Ask for a reset link

1. Open the sign-in page and choose **Forgot password**.
2. Enter the email address on your account.
3. We email you a link. It works **once** and expires after **one hour**.

We send the same answer whether or not the address has an account, so nobody can use this page to find out who shops with us.

## Choose a new password

Your new password needs at least 12 characters. A short sentence you can remember works well. Choosing it signs you out on every other device.

## The link doesn't work

- **It has expired or was already used.** Ask for a new one; only the newest link works.
- **The email hasn't arrived.** Check your spam folder, then ask again after a few minutes.`,
  },
  {
    category: "accounts",
    slug: "create-an-account",
    title: "Create an account and see your past tickets",
    summary:
      "An account keeps every ticket you have raised in one place, including ones sent without signing in.",
    tags: ["account", "tickets"],
    published: true,
    body: `## Why create an account

You can contact support without an account: we email you a link to each ticket. With an account, every ticket you have raised is listed in one place, and you can reply without waiting for an email.

## How to sign up

1. Choose **Create account** and enter your email address.
2. Open the link we email you. It lasts 24 hours.
3. Choose your name and a password of at least 12 characters.

Tickets you sent from that email address before you signed up appear in your account straight away.

## Already have an account?

If you sign up with an address that already has an account, we email you a sign-in link instead. Use [Reset your password](/help/reset-your-password) if you have forgotten it.`,
  },
  {
    category: "accounts",
    slug: "change-account-email",
    title: "Change the email address on your account",
    summary:
      "Move your account, orders and receipts to a new email address after we confirm both inboxes are yours.",
    tags: ["account", "email"],
    published: true,
    body: `## Why we check both addresses

Your email address is how you sign in and how we reach you about orders, so we only change it once we know both inboxes belong to you.

## How to change it

1. Contact support **from your new email address** and say which address the account uses now.
2. We send a confirmation code to the **old** address. Reply with the code.
3. We move the account. Your order history, invoices and open tickets come with it, and receipts go to the new address from then on.

## You can't reach the old inbox

Tell us when you get in touch. We confirm it's you another way, using details from a recent order such as the order number, the delivery postcode and the last four digits of the card used. This takes a little longer, usually one working day.`,
  },
  {
    category: "accounts",
    slug: "delete-your-account",
    title: "Close your account and delete your personal data",
    summary:
      "We close the account straight away; our privacy team removes your personal data within 30 days.",
    tags: ["account", "privacy", "data"],
    published: true,
    body: `## Before you ask

- **Finish open orders and returns first.** We can't close an account while an order is on its way or a refund is pending.
- **Download your invoices.** They are removed with the account, and we can't send them afterwards. Each order page in your account has a download button.
- **Cancel any subscription,** such as Harbor cloud recording, or it ends when the account closes.

## How to close your account

Contact support and ask us to close it. We confirm that you have no open orders and that you have the invoices you need, then close it.

## What happens next

Signing in stops working at once. Our privacy team removes your personal data within **30 days** and emails you a final confirmation when it's done. We keep only what the law requires us to keep, such as payment records for tax purposes, and nothing that identifies you for marketing.`,
  },
  {
    category: "accounts",
    slug: "sign-in-problems",
    title: "You can't sign in",
    summary:
      "Most sign-in problems come from a mistyped address, a saved old password or too many attempts in a row.",
    tags: ["sign-in", "password", "account"],
    published: true,
    body: `## Check the basics

- Use the email address you signed up with. If you have changed it, the old one no longer works.
- Passwords are case sensitive. Check caps lock, and type the password rather than pasting a saved one, which may be out of date.
- Make sure your browser accepts cookies from our site: signing in needs one.

## "Too many attempts"

After several failed attempts we pause sign-in for that address for **15 minutes**, to protect your account from people guessing passwords. Wait, then try once more. If you're not sure of the password, [reset it](/help/reset-your-password) instead of guessing.

## You never finished signing up

If you started creating an account but never opened the link we emailed, there is no password to sign in with yet. Sign up again with the same address: we send a new link, which lasts 24 hours.

## Still stuck

Contact support from the email address on the account and tell us what message you see. We never ask for your password.`,
  },
  {
    category: "accounts",
    slug: "follow-a-request-without-an-account",
    title: "Follow a request without an account",
    summary:
      "Every email about your request carries a link that opens it. A link lasts 7 days, and you can ask for a new one at any time.",
    tags: ["tickets", "guest", "email"],
    published: true,
    body: `## The link in your emails

When you contact support without signing in, we email you to confirm we have your request. That email, and every email about the request after it, carries a link that opens the conversation, where you can read our replies and answer. Nobody else can open it, because the link only goes to your inbox.

Each link lasts **7 days**. The newest email always has a fresh one.

## Ask for a new link

If your link has expired or you can't find the email, choose **Find a request**, then enter the request reference (it looks like DSD-000123) and the email address you used. If they match, we email you a new link.

## Prefer to keep everything in one place?

[Create an account](/help/create-an-account) with the same email address. Requests you sent before signing up appear in your account straight away.`,
  },
  {
    category: "accounts",
    slug: "emails-about-your-requests",
    title: "Emails we send about your requests",
    summary:
      "We email you when we receive a request, when an agent replies and when its status changes.",
    tags: ["email", "notifications", "tickets"],
    published: true,
    body: `## When we email you

- **We've received your request.** Sent within a few minutes, with a link to it.
- **New reply.** When one of our agents answers. The email includes the reply, so you can read it without opening the request.
- **Status changes.** For example when we're waiting for your answer, or when we mark the request resolved.

A reply that also changes the status arrives as one email, not two.

## An email hasn't arrived

1. Check your spam or junk folder, and any "promotions" tab.
2. Add our support address to your contacts so future emails aren't filtered.
3. Make sure you used the right address: you can see it in your account, or in any earlier email from us.

Emails can be delayed by a few minutes. If our email provider has a problem, we keep trying and the email arrives once it is fixed. Your request is safe either way, and you can always [open it from a new link](/help/follow-a-request-without-an-account).`,
  },
];
