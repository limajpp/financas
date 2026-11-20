"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { finishOnboardingAction } from "@/app/(app)/comecar/actions";
import { Button } from "@/components/ui/button";

/** On home while the onboarding wasn't finished (task 22): continue it, or never see it again. */
export function OnboardingInvite() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function dismiss() {
    setError(null);
    startTransition(async () => {
      try {
        await finishOnboardingAction();
      } catch {
        setError("Não foi possível salvar. Verifique a conexão e tente de novo.");
      }
    });
  }

  return (
    <section
      aria-labelledby="onboarding-invite"
      className="mt-6 grid gap-3 rounded-xl border bg-muted/40 p-4"
    >
      <div className="grid gap-1">
        <h2 id="onboarding-invite" className="font-semibold">
          Termine de configurar o app
        </h2>
        <p className="text-sm text-muted-foreground">
          Contas, faturas abertas, parcelamentos e assinaturas de antes do app, para as faturas e o
          saldo já começarem certos.
        </p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button asChild className="h-10">
          <Link href="/comecar">Continuar</Link>
        </Button>
        <Button variant="ghost" className="h-10" disabled={pending} onClick={dismiss}>
          Não mostrar mais
        </Button>
      </div>
    </section>
  );
}
