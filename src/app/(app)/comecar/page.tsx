import type { Metadata } from "next";
import { Suspense } from "react";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { ONBOARDING_STEPS, parseStep } from "@/components/onboarding/steps";
import { onboardingData } from "@/server/onboarding";
import { generateRecurringSafely } from "@/server/recurring";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Começar · Finanças" };

/** The first use (task 22): accounts, cards and invoices, installments, subscriptions. */
export default function ComecarPage({
  searchParams,
}: {
  searchParams: Promise<{ passo?: string }>;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 md:px-8 md:py-10">
      <Suspense fallback={<p className="text-muted-foreground">Carregando…</p>}>
        <Wizard searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Wizard({ searchParams }: { searchParams: Promise<{ passo?: string }> }) {
  const [{ passo }, space] = await Promise.all([searchParams, getCurrentSpace()]);
  // Subscriptions due up to today first, so the balances shown include them (task 13).
  await generateRecurringSafely(space.id);
  const data = await onboardingData(space.id);
  const step = parseStep(passo);
  return <OnboardingWizard key={step} step={step} total={ONBOARDING_STEPS.length} data={data} />;
}
