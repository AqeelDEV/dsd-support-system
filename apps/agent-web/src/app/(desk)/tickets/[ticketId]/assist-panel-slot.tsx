/**
 * Where the AI suggestion panel goes (Phase 9; ADR-0006): at the top of
 * the ticket's side rail, above the properties, so a grounded draft sits
 * next to the composer without pushing the conversation down.
 *
 * It renders nothing until the panel exists: the slot is reserved in the
 * layout and the code, not shown as a feature that isn't there. The panel
 * will read `ai:suggestion:read` from `/me`, fetch the ticket's suggestion
 * from the staff-only endpoint, and offer "Insert into reply", which fills
 * the composer for the agent to edit and send. Nothing an AI writes is ever
 * sent from here.
 */
export function AssistPanelSlot(_props: { ticketId: string }) {
  return null;
}
