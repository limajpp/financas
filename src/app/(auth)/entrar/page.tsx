import type { Metadata } from "next";
import { Suspense } from "react";

import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";
import { SignInForm } from "@/components/auth/sign-in-form";

export const metadata: Metadata = { title: "Entrar · Finanças" };

export default function SignInPage() {
  return (
    <>
      <h2 className="mb-4 text-lg font-medium">Entrar</h2>
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <SignInForm />
    </>
  );
}
