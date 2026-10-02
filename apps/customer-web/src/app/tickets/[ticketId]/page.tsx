import { RequireSession } from "@/components/require-session";

import { TicketView } from "./ticket-view";

export default async function TicketPage({
  params,
}: {
  params: Promise<{ ticketId: string }>;
}) {
  const { ticketId } = await params;
  return (
    <RequireSession>
      <TicketView ticketId={ticketId} />
    </RequireSession>
  );
}
