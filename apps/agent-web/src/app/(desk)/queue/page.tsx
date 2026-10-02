import type { Metadata } from "next";
import { Suspense } from "react";

import { QueueView } from "./queue-view";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage() {
  return (
    <Suspense>
      <QueueView />
    </Suspense>
  );
}
