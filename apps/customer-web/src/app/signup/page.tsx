import type { Metadata } from "next";

import { SignupView } from "./signup-view";

export const metadata: Metadata = { title: "Create an account" };

export default function SignupPage() {
  return <SignupView />;
}
