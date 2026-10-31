import type { Metadata } from "next";
import { Suspense } from "react";

import { RedirectIfSignedIn } from "@/components/auth/redirect-if-signed-in";
import { SignUpForm } from "@/components/auth/sign-up-form";

export const metadata: Metadata = { title: "Criar conta · Finanças" };

export default function SignUpPage() {
  return (
    <>
      <h2 className="mb-4 text-lg font-medium">Criar conta</h2>
      <Suspense>
        <RedirectIfSignedIn />
      </Suspense>
      <SignUpForm />
    </>
  );
}
