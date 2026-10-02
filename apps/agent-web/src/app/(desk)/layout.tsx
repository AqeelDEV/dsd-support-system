import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

/** Every signed-in page: the session gate, the sidebar and the phone menu. */
export default function DeskLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
