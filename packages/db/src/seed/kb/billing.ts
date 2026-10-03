import type { CatalogArticle } from "../kb-catalog.js";

/** Payments, refunds, invoices, cancellations and subscriptions. */
export const BILLING_ARTICLES: readonly CatalogArticle[] = [
  {
    category: "billing",
    slug: "refund-timescales",
    title: "How long refunds take",
    summary:
      "Refunds go back to the card you paid with, usually within 3 to 5 working days of being issued.",
    tags: ["refund", "payment"],
    published: true,
    body: `## When we issue the refund

- **Cancelled orders** are refunded as soon as the cancellation is confirmed.
- **Returns** are refunded when the device reaches our warehouse and passes inspection, usually within 2 working days of arrival.

## When you see the money

Refunds go back to the card or account you paid with. Most banks show them within **3 to 5 working days** of the day we issue them. Some take up to 10.

## It has been longer than that

Contact support with your order number and the date of the refund email. We can send you the payment reference so your bank can trace it.`,
  },
  {
    category: "billing",
    slug: "change-payment-method",
    title: "Change the card for an order or subscription",
    summary:
      "Update the card on a subscription any time; an order that has shipped can't change card.",
    tags: ["payment", "subscription"],
    published: true,
    body: `## Subscriptions

Cloud recording for the Harbor Indoor Camera is billed monthly. To change the card, open **Account**, then **Subscriptions**, and choose **Update payment method**. The next payment uses the new card.

## Orders

An order that hasn't shipped yet can be cancelled and placed again with another card. Once it has shipped, the payment can't be moved to a different card.

## A payment failed

We try a failed subscription payment again after 3 days and email you each time. Recording keeps working for 14 days while you update the card.`,
  },
  {
    category: "billing",
    slug: "charged-twice",
    title: "You were charged twice for one order",
    summary:
      "A second charge is usually a temporary card authorisation that disappears within 5 working days. If both payments completed, we refund the duplicate.",
    tags: ["payment", "refund", "duplicate"],
    published: true,
    body: `## Pending or completed?

When you place an order, your bank may show a temporary **authorisation** as well as the payment itself. The authorisation is not money taken: it drops off by itself, usually within **5 working days**, sometimes a little longer depending on your bank.

Check your statement or banking app:

- **One payment completed and one pending:** the pending one is the authorisation. Wait for it to disappear.
- **Both payments completed:** you were charged twice. Contact us.

## When you were charged twice

Send us the order number and the date and amount of both payments. Once our payments team confirms the duplicate with the payment provider, we refund it to the same card. The refund usually reaches you within **3 to 5 working days**; see [How long refunds take](/help/refund-timescales).

## Charged for an order you didn't place?

Contact your bank to block the card first, then contact us so we can investigate.`,
  },
  {
    category: "billing",
    slug: "invoice-with-company-details",
    title: "Get an invoice with your company details",
    summary:
      "We can reissue an order's invoice with your company name, registered address and VAT number.",
    tags: ["invoice", "vat", "business"],
    published: true,
    body: `## What we need

Contact support with the order number and the details exactly as they should appear on the invoice:

- the company's registered name;
- its registered address;
- its VAT number, if it has one.

We check that the VAT number is in a valid format before we issue the invoice.

## Getting the invoice

We reissue the invoice with your company details, usually within one working day. Download it from the order page in your account. The original invoice is replaced, so your records only ever hold one invoice per order.

## Several orders

You can ask for several orders in one message. List every order number; each gets its own invoice.`,
  },
  {
    category: "billing",
    slug: "card-declined",
    title: "Your card is declined at checkout",
    summary:
      "Most declines come from a billing address that doesn't match your bank's records, or from the bank's security check.",
    tags: ["payment", "card", "checkout"],
    published: true,
    body: `## Check the billing address

The billing address you enter must match the address your bank has for the card, including the postcode. An old address is the most common reason for a decline at our checkout.

## The bank's security check

Many cards ask you to approve the payment in your banking app or with a code by text message. If that step times out or you close the window, the payment is declined. Try again and keep the checkout open until the bank confirms.

## Still declined

- Make sure the card hasn't expired and has enough available balance or credit.
- Try a different card.
- Ask your bank whether they declined it. If they say they didn't, contact us with the time of the attempt and the last four digits of the card, and we'll check with our payment provider.

A declined payment doesn't take money from your account, but some banks show it as pending for a few days.`,
  },
  {
    category: "billing",
    slug: "cancel-an-order",
    title: "Cancel an order",
    summary:
      "Cancel from the order page until the order is picked; after that, return it instead.",
    tags: ["order", "cancel", "refund"],
    published: true,
    body: `## Before it's picked

Open the order in your account and choose **Cancel order**. You can do this until our warehouse starts picking it, usually within a couple of hours of ordering. The refund is issued as soon as the cancellation is confirmed; see [How long refunds take](/help/refund-timescales).

## Once it's on its way

An order that has been picked or dispatched can't be cancelled. When it arrives, [return it](/help/return-a-device) within 30 days for a full refund. You can also refuse the parcel at the door: it comes back to us and we refund it once it arrives.

## Part of an order

You can't cancel one item from an order online. Contact support before the order is picked and we'll remove it for you.`,
  },
  {
    category: "billing",
    slug: "harbor-cloud-recording-plan",
    title: "Harbor cloud recording: plans, billing and cancelling",
    summary:
      "Cloud recording for the Harbor Indoor Camera is billed monthly and can be cancelled at any time.",
    tags: ["harbor", "subscription", "billing"],
    published: true,
    body: `## What the plan includes

Cloud recording keeps video from your Harbor Indoor Cameras for **30 days**, so you can review or download clips from the app. Without it, the camera still records to its memory card and shows live video.

## Billing

The plan is billed monthly on the day you started it, to the card in **Account**, then **Subscriptions**. To change the card, see [Change the card for an order or subscription](/help/change-payment-method).

## Cancelling

Choose **Cancel subscription** under **Account**, then **Subscriptions**. Recording continues until the end of the month you have paid for, then stops; we don't refund part months. Clips already saved stay available until they are 30 days old.

## A payment failed

We try again after 3 days and email you each time. Recording keeps working for 14 days while you update the card; after that it pauses until a payment succeeds.`,
  },
];
