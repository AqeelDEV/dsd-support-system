import type { Metadata } from "next";

import { RequireSession } from "@/components/require-session";

import { TicketsView } from "./tickets-view";

export const metadata: Metadata = { title: "My requests" };

export default function TicketsPage() {
  return (
    <RequireSession>
      <TicketsView />
    </RequireSession>
  );
}
