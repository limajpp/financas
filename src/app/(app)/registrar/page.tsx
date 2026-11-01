import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { RegisterForm } from "@/components/register/register-form";
import { Button } from "@/components/ui/button";
import { todayInSaoPaulo } from "@/domain/dates";
import { registerData } from "@/server/register";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Registrar · Finanças" };

export default function RegistrarPage() {
  return (
    <div className="mx-auto w-full max-w-md px-4 pt-4 md:py-10">
      <h1 className="sr-only">Registrar</h1>
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <Register />
      </Suspense>
    </div>
  );
}

async function Register() {
  const space = await getCurrentSpace();
  const data = await registerData(space.id);
  if (data.accounts.length === 0) {
    return (
      <div className="grid justify-items-start gap-4 py-6">
        <p className="text-muted-foreground">Cadastre uma conta para começar a registrar.</p>
        <Button asChild>
          <Link href="/contas">Ir para Contas</Link>
        </Button>
      </div>
    );
  }
  return <RegisterForm {...data} today={todayInSaoPaulo()} />;
}
