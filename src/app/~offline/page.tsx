import type { Metadata } from "next";

import { RetryButton } from "@/components/pwa/retry-button";

export const metadata: Metadata = { title: "Sem conexão · Finanças" };

// Precached by the service worker: shown when there is no network and no saved copy of a screen.
export default function OfflinePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Você está sem conexão</h1>
      <p className="max-w-sm text-muted-foreground">
        O que já foi aberto continua disponível. Quando a conexão voltar, tente de novo.
      </p>
      <RetryButton />
    </main>
  );
}
