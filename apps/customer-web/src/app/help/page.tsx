import type { Metadata } from "next";
import { Suspense } from "react";

import { HelpView } from "./help-view";

export const metadata: Metadata = { title: "Help centre" };

export default function HelpPage() {
  return (
    <Suspense>
      <HelpView />
    </Suspense>
  );
}
