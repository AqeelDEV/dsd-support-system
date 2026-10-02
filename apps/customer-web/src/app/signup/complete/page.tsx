import type { Metadata } from "next";

import { SignupCompleteView } from "./signup-complete-view";

export const metadata: Metadata = { title: "Finish creating your account" };

export default function SignupCompletePage() {
  return <SignupCompleteView />;
}
