import type { Metadata } from "next";
import { Suspense } from "react";

import { KbListView } from "./kb-list-view";

export const metadata: Metadata = { title: "Knowledge base" };

export default function KbPage() {
  return (
    <Suspense>
      <KbListView />
    </Suspense>
  );
}
