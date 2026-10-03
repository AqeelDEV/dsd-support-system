import type { Category } from "./catalog.js";

/*
 * A starter knowledge base for the demo: a few articles per category for
 * the same fictional smart-home retailer as the tickets. Phase 9 grows it
 * to 30 to 40 articles for the AI suggestions to draw on. The markdown is
 * plain (no HTML, safe links only), as the API's sanitiser would leave it.
 */

export const KB_CATEGORIES: readonly {
  key: Category;
  slug: string;
  name: string;
  position: number;
}[] = [
  { key: "accounts", slug: "your-account", name: "Your account", position: 1 },
  {
    key: "billing",
    slug: "orders-and-billing",
    name: "Orders and billing",
    position: 2,
  },
  {
    key: "delivery",
    slug: "delivery-and-returns",
    name: "Delivery and returns",
    position: 3,
  },
  {
    key: "troubleshooting",
    slug: "troubleshooting",
    name: "Troubleshooting",
    position: 4,
  },
];

export interface CatalogArticle {
  category: Category;
  slug: string;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  /** Drafts are visible to staff only. */
  published: boolean;
}

export const KB_ARTICLES: readonly CatalogArticle[] = [
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
    category: "delivery",
    slug: "track-your-delivery",
    title: "Track your delivery",
    summary:
      "Every order gets a tracking link by email once it leaves the warehouse.",
    tags: ["delivery", "tracking"],
    published: true,
    body: `## Where to find tracking

When your order leaves the warehouse we email a tracking link. Tracking can take up to 24 hours to show the first scan.

## Delivery times

- **Standard:** 3 to 5 working days.
- **Express:** next working day when ordered before 2 pm.

## The parcel hasn't moved

If tracking hasn't changed for 3 working days, contact support with your order number. We open a trace with the courier, which usually takes 2 working days, and send a replacement or a refund if the parcel is lost.`,
  },
  {
    category: "delivery",
    slug: "return-a-device",
    title: "Return a device",
    summary:
      "Return any device within 30 days of delivery for a refund; faulty devices within the 2-year warranty.",
    tags: ["returns", "refund", "warranty"],
    published: true,
    body: `## Changed your mind

You can return a device within **30 days** of delivery. It should be complete, with its box and accessories.

1. Contact support with your order number to get a returns label.
2. Pack the device and attach the label.
3. Drop it at any courier point. Keep the receipt.

## Faulty devices

Every device has a **2-year warranty**. Tell us what is wrong and we will try to fix it remotely first; if we can't, we send a replacement before you return the faulty one.

## Refunds

See [How long refunds take](/help/refund-timescales).`,
  },
  {
    category: "troubleshooting",
    slug: "nimbus-router-dropping-connection",
    title: "Nimbus Mesh Router keeps dropping the connection",
    summary:
      "Most drop-outs come from a node placed too far away or old firmware. Check both before a factory reset.",
    tags: ["nimbus", "wifi", "router"],
    published: true,
    body: `## Check where the nodes are

Each node should be no more than two rooms from the next, away from microwaves and large metal objects. In the app, a node with a **red** link light is too far away.

## Update the firmware

Open the Nimbus app, choose **Settings**, then **Firmware**. Updates take about 10 minutes and restart the network once.

## Restart in the right order

1. Unplug every node and your broadband modem.
2. Plug the modem in and wait until it is online.
3. Plug in the main node, wait for a **white** light, then the others.

## Still dropping

A factory reset is the last step: hold the reset button on the main node for 10 seconds. You will need to set the network up again in the app. Contact support if drop-outs continue afterwards.`,
  },
  {
    category: "troubleshooting",
    slug: "harbor-camera-offline",
    title: "Harbor Indoor Camera shows as offline",
    summary:
      "An offline camera has usually lost its Wi-Fi. Check the light, the network name and the power supply.",
    tags: ["harbor", "camera", "wifi"],
    published: true,
    body: `## Read the light

- **Blinking blue:** the camera is looking for Wi-Fi.
- **Solid red:** it is connected to Wi-Fi but can't reach our service.
- **No light:** check the power supply and cable.

## Wi-Fi changes

If you changed your Wi-Fi name or password, the camera can't join until you set it up again: in the app choose the camera, then **Settings**, then **Wi-Fi**.

## It goes offline at night

Some routers turn Wi-Fi off on a schedule. Check your router's settings, or use a Nimbus node near the camera.

Recordings made while the camera was offline are kept on its memory card and uploaded when it reconnects.`,
  },
  {
    category: "troubleshooting",
    slug: "tempo-thermostat-firmware",
    title: "Updating the Tempo Smart Thermostat",
    summary: "Draft: firmware update steps for the next Tempo release.",
    tags: ["tempo", "thermostat", "firmware"],
    published: false,
    body: `## Before you start

Make sure the thermostat is online and its battery is above 30%.

## Steps

1. Open the Tempo app and choose the thermostat.
2. Choose **Settings**, then **Firmware**, then **Update**.

The heating keeps its schedule during the update.`,
  },
];
