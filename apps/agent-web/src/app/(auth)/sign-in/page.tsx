import type { Metadata } from "next";
import { Suspense } from "react";

import { SignInView } from "./sign-in-view";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <Suspense>
      <SignInView />
    </Suspense>
  );
}
