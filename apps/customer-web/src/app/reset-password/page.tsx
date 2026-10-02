import type { Metadata } from "next";

import { ResetPasswordView } from "./reset-password-view";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return <ResetPasswordView />;
}
