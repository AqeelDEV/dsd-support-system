import type { CatalogArticle } from "../kb-catalog.js";

/** Tracking, delivery problems, returns and where we deliver. */
export const DELIVERY_ARTICLES: readonly CatalogArticle[] = [
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
    category: "delivery",
    slug: "parcel-marked-delivered-not-received",
    title: "Tracking says delivered, but the parcel isn't here",
    summary:
      "Couriers sometimes mark a parcel delivered early or leave it nearby. Check safe places, then tell us by the end of the next day.",
    tags: ["delivery", "missing", "courier"],
    published: true,
    body: `## Check first

- Look in any safe place the courier might use: a porch, a garden shed, a bin store or behind a gate.
- Ask your neighbours and your building's reception, if there is one.
- Check the tracking page for a delivery photo or a note about where it was left.

Couriers sometimes mark a parcel delivered a day before it arrives, so it may still turn up.

## Not there by the end of the next day

Contact support with your order number. We open an investigation with the courier, which usually takes **2 working days**; their records include the location of the delivery scan.

## If it's lost

When the courier confirms the parcel went astray, we send a replacement by tracked next-day delivery at no cost, or refund you if you prefer. You don't need to wait for the courier's claim to be settled.`,
  },
  {
    category: "delivery",
    slug: "late-delivery",
    title: "Your delivery is late",
    summary:
      "If an order is past its delivery date, check tracking for a depot delay, then contact us so we can chase the courier.",
    tags: ["delivery", "late", "courier"],
    published: true,
    body: `## How long delivery takes

Standard delivery takes **3 to 5 working days** and express delivery arrives the next working day when ordered before 2 pm. Working days are Monday to Friday, excluding public holidays.

## Past the delivery date

1. Open the tracking link from your dispatch email. "In transit" with a recent scan at a depot usually means a sorting delay; most parcels arrive within 2 more working days.
2. If tracking hasn't changed for 3 working days, contact support with your order number. We ask the courier to prioritise the parcel and keep an eye on it for you. See also [Track your delivery](/help/track-your-delivery).

## Express orders that arrive late

If an express delivery arrives after the promised day, we refund the express charge. You don't need to ask: tell us the order number when you contact us, or we refund it automatically once the courier confirms the delay.`,
  },
  {
    category: "delivery",
    slug: "wrong-item-received",
    title: "You received the wrong item",
    summary:
      "Send us a photo of the item and the box label; we send the right one and collect the wrong one at no cost.",
    tags: ["delivery", "wrong item", "returns"],
    published: true,
    body: `## What to send us

Contact support with your order number and attach:

- a photo of the item you received;
- a photo of the label on the box, showing the barcode.

Please don't use the item, and keep it in its packaging.

## What happens next

Once we have the photos we send the correct item straight away. The courier collects the wrong item when they deliver the right one, so you don't need to print a label or visit a courier point. There's nothing to pay.

## Something missing from the box

If an accessory or part is missing rather than the wrong item sent, tell us what's missing and we send it separately.`,
  },
  {
    category: "delivery",
    slug: "change-delivery-address",
    title: "Change the delivery address of an order",
    summary:
      "We can change the address until the warehouse starts picking the order. After that the address is fixed.",
    tags: ["delivery", "address", "order"],
    published: true,
    body: `## Before the order is picked

Contact support as soon as possible with your order number and the full new address, including the postcode. If the warehouse hasn't started picking the order, we update the address and you get tracking for the new address once it is dispatched.

## After it has been picked or dispatched

The address can't be changed any more, and the courier can't redirect it for us. You can:

- ask someone at the original address to take it in;
- refuse the parcel, so it comes back to us and we refund it once it arrives;
- or, once it's delivered, [return it](/help/return-a-device) within 30 days.

## Next time

Check the delivery address on the last checkout step. Your account keeps several addresses, and you choose one for each order.`,
  },
  {
    category: "delivery",
    slug: "damaged-on-arrival",
    title: "A device arrived damaged",
    summary:
      "Tell us within 14 days of delivery with photos of the device and the box, and we send a replacement.",
    tags: ["delivery", "damaged", "replacement"],
    published: true,
    body: `## Tell us within 14 days

Contact support within **14 days** of delivery with your order number and photos of:

- the damage to the device;
- the outside of the box, especially any dents or tears.

Keep the device and all the packaging until the case is closed.

## What happens next

We send a replacement as soon as we've seen the photos, before you return anything. The courier collects the damaged device when they deliver the new one, at no cost to you.

## Damage you notice later

If a device stops working properly after the first two weeks, it's covered by the **2-year warranty** instead; see [Return a device](/help/return-a-device).`,
  },
  {
    category: "delivery",
    slug: "where-we-deliver",
    title: "Where we deliver",
    summary:
      "We deliver to addresses in the UK and in EU countries. We don't ship to other countries yet.",
    tags: ["delivery", "international", "countries"],
    published: true,
    body: `## Countries

We deliver to addresses in the **United Kingdom** and in **EU countries**. We don't ship anywhere else yet, and we can't send orders to parcel-forwarding addresses.

## Delivery times outside the UK

Standard delivery to EU countries takes **5 to 8 working days**. Express delivery is available to the UK only.

## Customs and charges

Prices at checkout include everything for UK and EU deliveries: there are no customs fees to pay on arrival.

## Devices and power plugs

Devices come with the right plug for the delivery country. Every device works on 220 to 240 volts.`,
  },
];
