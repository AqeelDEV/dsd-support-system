import type { Metadata } from "next";

import { AccessView } from "./access-view";

export const metadata: Metadata = { title: "Opening your request" };

export default function AccessPage() {
  return <AccessView />;
}
