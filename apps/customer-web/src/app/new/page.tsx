import type { Metadata } from "next";

import { NewTicketView } from "./new-ticket-view";

export const metadata: Metadata = { title: "Contact support" };

export default function NewTicketPage() {
  return <NewTicketView />;
}
