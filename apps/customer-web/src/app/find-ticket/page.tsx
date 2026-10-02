import type { Metadata } from "next";

import { FindTicketView } from "./find-ticket-view";

export const metadata: Metadata = { title: "Find a request" };

export default function FindTicketPage() {
  return <FindTicketView />;
}
