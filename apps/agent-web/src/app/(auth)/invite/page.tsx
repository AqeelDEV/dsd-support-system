import type { Metadata } from "next";

import { InviteView } from "./invite-view";

export const metadata: Metadata = { title: "Join the support team" };

export default function InvitePage() {
  return <InviteView />;
}
