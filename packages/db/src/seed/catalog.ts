/**
 * Hand-written support scenarios for the demo data. DSD here is a
 * fictional retailer of smart-home devices; every product, order and
 * person is invented. Placeholders in braces are filled per ticket:
 * {customer}, {agent}, {product}, {order}, {amount}, {date}, {city}.
 */

import type { SeedFileKind } from "./files.js";

export type Category = "accounts" | "billing" | "delivery" | "troubleshooting";

export interface Scenario {
  category: Category;
  subject: string;
  description: string;
  /** The first public agent reply, which usually asks for something. */
  agentReply: string;
  /** The customer's answer, which brings the ticket back to the queue. */
  customerFollowUp: string;
  /** A staff-only note left while working the ticket. */
  internalNote: string;
  /** The reply that resolves the ticket. */
  resolution: string;
  /**
   * A file the customer sends: with the request itself, or with their
   * follow-up ("I've attached photos...").
   */
  attachment?: {
    kind: SeedFileKind;
    filename: string;
    on: "description" | "follow-up";
  };
}

/** A fictional product line, so no real brand appears in the demo. */
export const PRODUCTS = [
  "Tempo Smart Thermostat",
  "Harbor Indoor Camera",
  "Lumen Desk Lamp",
  "Nimbus Mesh Router",
  "Pace Fitness Band",
  "Quill Smart Plug",
] as const;

export const SCENARIOS: readonly Scenario[] = [
  {
    category: "accounts",
    subject: "New password isn't accepted after a reset",
    description:
      "I reset my password this morning using the link you emailed, but the new password is rejected every time I try to sign in. I've checked caps lock and tried two browsers.",
    agentReply:
      "Hi {customer}, sorry about that. Reset links can only be used once, so if the page was opened twice the second password may not have been saved. Could you request a fresh link and use it straight away in the same browser?",
    customerFollowUp:
      "I requested a new link and set the password again, but it still says the password is wrong.",
    internalNote:
      "Account shows two reset requests within a minute. Cleared the pending reset tokens so the next link is the only valid one.",
    resolution:
      "Thanks for your patience, {customer}. I've cleared the older reset requests on your account, so the next link you request will work. Once you've set the password you'll be signed in straight away.",
  },
  {
    category: "accounts",
    subject: "Change the email address on my account",
    description:
      "I no longer use the email address on my DSD account. Can you move my account and order history to my new address?",
    agentReply:
      "Hi {customer}, we can do that. For security we need to confirm both addresses: please reply from the new address, and we'll send a confirmation code to the old one.",
    customerFollowUp:
      "I'm replying from my new address now. I still have access to the old inbox for the code.",
    internalNote:
      "Identity confirmed through both inboxes. Safe to update the email.",
    resolution:
      "All done, {customer}. Your account and order history now use your new email address, and receipts will go there from now on.",
  },
  {
    category: "accounts",
    subject: "Please delete my account and personal data",
    description:
      "I'd like to close my DSD account and have my personal data removed. I have no open orders.",
    agentReply:
      "Hi {customer}, we can close your account. Before we do, please confirm you don't need the invoices for your past orders, because they are removed with the account.",
    customerFollowUp:
      "Confirmed, I've downloaded what I need. Please go ahead.",
    internalNote:
      "No open orders or returns. Passed to the privacy team for erasure, reference PRV-{order}.",
    resolution:
      "Thanks, {customer}. Your account is closed and our privacy team will finish removing your personal data within 30 days. You'll get a final confirmation email when that's done.",
  },
  {
    category: "billing",
    subject: "Charged twice for order {order}",
    attachment: {
      kind: "screenshot",
      filename: "bank-app-payments.png",
      on: "description",
    },
    description:
      "My bank statement shows two payments of {amount} for order {order}, placed on {date}. I only placed the order once.",
    agentReply:
      "Hi {customer}, thanks for flagging this. The second charge is usually a card authorisation that drops off within five working days. Could you tell me whether both payments show as completed rather than pending?",
    customerFollowUp:
      "Both show as completed, not pending. It's been more than a week.",
    internalNote:
      "Payment provider confirms a duplicate capture on {order}. Refund of {amount} raised for the second capture.",
    resolution:
      "You were right, {customer}: the payment was taken twice. I've refunded the duplicate {amount} to your card; it usually appears within 3 to 5 working days.",
  },
  {
    category: "billing",
    subject: "Refund for my returned {product} hasn't arrived",
    attachment: {
      kind: "receipt",
      filename: "returns-receipt.pdf",
      on: "description",
    },
    description:
      "I returned the {product} from order {order} two weeks ago and the tracking shows it was delivered to your warehouse, but I haven't received the {amount} refund yet.",
    agentReply:
      "Hi {customer}, thanks for your patience. Returns are checked within 5 working days of arrival and the refund is issued straight after. Could you send the return tracking number so I can find the parcel?",
    customerFollowUp:
      "The return tracking number is on the label: RT{order}. It was signed for by your warehouse.",
    internalNote:
      "Return found; it was scanned in but never inspected. Asked the warehouse to prioritise it.",
    resolution:
      "Good news, {customer}: your return has been checked and a refund of {amount} is on its way to your original payment method.",
  },
  {
    category: "billing",
    subject: "Invoice with our company details for order {order}",
    description:
      "I bought a {product} for our office and need an invoice showing our company name and VAT number for our accounts team.",
    agentReply:
      "Hi {customer}, happy to help. Please reply with the company name, registered address and VAT number exactly as they should appear on the invoice.",
    customerFollowUp:
      "Company: Brightwater Design Ltd, 12 Harbour Road, {city}. VAT number GB000000000.",
    internalNote:
      "VAT number format checked. Reissued the invoice with the company details.",
    resolution:
      "Here you are, {customer}: I've reissued the invoice for {order} with your company details. You can download it from the order page in your account.",
  },
  {
    category: "billing",
    subject: "Card declined at checkout",
    description:
      "My card is declined every time I try to pay for a {product}, but it works everywhere else. My bank says they haven't blocked anything.",
    agentReply:
      "Hi {customer}, sorry about the trouble. Could you check that the billing address matches the one your bank has on file? A mismatch is the most common reason for a decline at our checkout.",
    customerFollowUp:
      "The billing address had an old postcode. I've updated it, but the payment still fails.",
    internalNote:
      "Payment logs show the bank's 3-D Secure check timing out. Known issue with one card issuer this week.",
    resolution:
      "Thanks for trying again, {customer}. The declines were caused by a security-check timeout on your bank's side, which has now been fixed. Your order should go through normally.",
  },
  {
    category: "delivery",
    subject: "Parcel marked as delivered but not received",
    description:
      "Tracking for order {order} says it was delivered yesterday, but there's nothing at my door and my neighbours haven't taken it in.",
    agentReply:
      "Hi {customer}, I'm sorry your parcel hasn't turned up. Couriers sometimes mark parcels as delivered a day early. Could you check any safe places and let me know if it hasn't appeared by tomorrow evening?",
    customerFollowUp:
      "Still nothing today, and I've checked everywhere. Can you send a replacement?",
    internalNote:
      "Courier investigation opened. GPS shows the delivery scan two streets away.",
    resolution:
      "Thanks for waiting, {customer}. The courier confirmed the parcel went to the wrong address, so we've sent a replacement {product} by tracked next-day delivery at no cost.",
  },
  {
    category: "delivery",
    subject: "Order {order} is past its delivery date",
    description:
      "My order was due on {date} but it still shows as 'in transit'. I need the {product} before the weekend.",
    agentReply:
      "Hi {customer}, sorry for the delay. Your parcel is at the courier's {city} depot and is booked for delivery tomorrow. I'll keep an eye on it for you.",
    customerFollowUp:
      "It didn't arrive today either, and the tracking hasn't changed.",
    internalNote:
      "Depot reports a sorting backlog. Requested priority handling.",
    resolution:
      "Your parcel was delivered this morning, {customer}. I've refunded the delivery charge as an apology for the wait.",
  },
  {
    category: "delivery",
    subject: "Received the wrong item",
    attachment: {
      kind: "photo",
      filename: "parcel-label.png",
      on: "follow-up",
    },
    description:
      "I ordered a {product} but the box contained a different product. The packing slip does show my order number, {order}.",
    agentReply:
      "Hi {customer}, sorry about the mix-up. Could you send a photo of the item and the label on the box? Then I'll arrange the swap.",
    customerFollowUp: "I've attached photos of the item and the barcode label.",
    internalNote:
      "Picking error confirmed from the photos. Collection booked; replacement sent in parallel.",
    resolution:
      "Thanks, {customer}. The correct {product} is on its way, and the courier will collect the wrong item when they deliver it. There's nothing to pay.",
  },
  {
    category: "delivery",
    subject: "Change delivery address before dispatch",
    description:
      "I've just placed order {order} and realised it's going to my old address. Can it be sent to my new address in {city} instead?",
    agentReply:
      "Hi {customer}, we can change it as long as the order hasn't been picked yet. Please reply with the full new address, including the postcode.",
    customerFollowUp:
      "The new address is 4 Mill Lane, {city}. Thanks for checking.",
    internalNote:
      "Order was still in the queue; address updated before picking.",
    resolution:
      "Done, {customer}: order {order} will now be delivered to 4 Mill Lane, {city}. You'll get tracking once it's dispatched.",
  },
  {
    category: "troubleshooting",
    subject: "{product} won't connect to Wi-Fi",
    description:
      "My new {product} gets stuck on 'connecting' during setup. Other devices on the same network work fine.",
    agentReply:
      "Hi {customer}, thanks for the detail. The {product} only supports 2.4 GHz networks during setup. If your router combines 2.4 and 5 GHz under one name, could you try setting it up with the 5 GHz band switched off for a moment?",
    customerFollowUp:
      "I split the bands and it still gets stuck at the same step.",
    internalNote:
      "Setup logs show the router rejecting the device with a WPA3-only setting.",
    resolution:
      "Found it, {customer}: your router is set to WPA3-only, which the {product} doesn't support yet. Switching the router to WPA2/WPA3 mixed mode lets it connect, and a firmware update adding WPA3 is due next month.",
  },
  {
    category: "troubleshooting",
    subject: "{product} offline since the latest update",
    attachment: { kind: "log", filename: "device-log.txt", on: "description" },
    description:
      "Since the update on {date} my {product} shows as offline in the app, even though its light says it's connected.",
    agentReply:
      "Hi {customer}, sorry about this. Could you hold the reset button for five seconds to restart the device, without resetting it to factory settings, and tell me what the light does afterwards?",
    customerFollowUp:
      "After the restart the light blinks green twice and then stays solid, but the app still says offline.",
    internalNote:
      "Matches the known cloud-registration bug in firmware 3.2.1. Fix rolled out in 3.2.2.",
    resolution:
      "Thanks for testing, {customer}. This was a known issue with the previous update. Version 3.2.2 fixes it and has been pushed to your {product}; it should show online within a few minutes.",
  },
  {
    category: "troubleshooting",
    subject: "Battery on my {product} drains in a day",
    description:
      "The battery on my {product} used to last a week but now runs out in less than a day, even with notifications turned off.",
    agentReply:
      "Hi {customer}, that's much shorter than it should be. Could you tell me which firmware version the app shows under Device, and whether continuous heart-rate monitoring is on?",
    customerFollowUp: "Firmware is 5.0.4 and continuous monitoring is off.",
    internalNote:
      "5.0.4 has a sensor-polling bug. Replacement authorised under warranty in case the fix doesn't help.",
    resolution:
      "Thanks, {customer}. Firmware 5.0.5 fixes the battery drain and is now available in the app. If the battery still doesn't last after updating, reply here and we'll replace the {product} under warranty.",
  },
  {
    category: "troubleshooting",
    subject: "Mesh node keeps dropping off the network",
    description:
      "One node of my {product} disconnects several times a day, always the one upstairs. The main unit is fine.",
    agentReply:
      "Hi {customer}, thanks for the report. Could you try moving the upstairs node halfway towards the main unit for a day? That tells us whether it's signal strength or the node itself.",
    customerFollowUp: "I moved it closer and it hasn't dropped once since.",
    internalNote:
      "Signal issue, not hardware. Suggest a wired backhaul or an extra node.",
    resolution:
      "That confirms it, {customer}: the node was just out of range. Keeping it where it is now, or connecting it to the main unit with a network cable, will keep it stable.",
  },
];

/** Reply templates for agents (FR-12). Variables are filled in by the API. */
export const CANNED_RESPONSES = [
  {
    title: "Order status check",
    body: "Hi {{customer.name}}, thanks for getting in touch about {{ticket.reference}}. I'm checking the latest status of your order with our warehouse and will update you shortly.\n\n{{agent.name}}",
  },
  {
    title: "Refund issued",
    body: "Hi {{customer.name}}, I've issued your refund today. It usually appears on your statement within 3 to 5 working days.\n\n{{agent.name}}",
  },
  {
    title: "Password reset steps",
    body: "Hi {{customer.name}}, to reset your password, choose 'Forgot password' on the sign-in page and follow the link we email you. The link works once and expires after an hour.\n\n{{agent.name}}",
  },
  {
    title: "Delivery delayed",
    body: "Hi {{customer.name}}, I'm sorry your delivery is running late. The courier has confirmed a new delivery date and I'll keep an eye on {{ticket.reference}} until it arrives.\n\n{{agent.name}}",
  },
  {
    title: "Need more information",
    body: "Hi {{customer.name}}, thanks for the details so far. To take this further, could you send a photo or screenshot of the problem and the order number it relates to?\n\n{{agent.name}}",
  },
  {
    title: "Closing a resolved ticket",
    body: "Hi {{customer.name}}, I'm glad that's sorted. I'll close {{ticket.reference}} now, but you can reply at any time if anything else comes up.\n\n{{agent.name}}",
  },
] as const;
