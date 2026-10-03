import type { Category } from "./catalog.js";
import { ACCOUNT_ARTICLES } from "./kb/accounts.js";
import { BILLING_ARTICLES } from "./kb/billing.js";
import { DELIVERY_ARTICLES } from "./kb/delivery.js";
import { TROUBLESHOOTING_ARTICLES } from "./kb/troubleshooting.js";

/*
 * The knowledge base for the demo (FR-24): about 35 articles across four
 * categories for the same fictional smart-home retailer as the tickets,
 * enough for AI suggestions to ground replies in and for the evaluation set
 * to test against. Two are drafts, which neither customers nor the AI see.
 * Facts agree across articles and with the ticket scenarios (refund times,
 * the 30-day return window, the 2-year warranty, link lifetimes). The
 * markdown is plain (no HTML, safe links only), as the API's sanitiser
 * would leave it, and links point at the help centre's `/help/<slug>` pages.
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
  ...ACCOUNT_ARTICLES,
  ...BILLING_ARTICLES,
  ...DELIVERY_ARTICLES,
  ...TROUBLESHOOTING_ARTICLES,
];
