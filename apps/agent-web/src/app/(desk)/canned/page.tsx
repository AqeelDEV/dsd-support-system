import type { Metadata } from "next";

import { CannedView } from "./canned-view";

export const metadata: Metadata = { title: "Canned responses" };

export default function CannedPage() {
  return <CannedView />;
}
