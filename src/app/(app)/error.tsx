"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * A screen that failed to load (task 26). The details stay in the server's log (Next sends the
 * browser only a generic message and an id); here, a plain sentence and two ways out.
 */
export default function ScreenError({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div
      role="alert"
      className="mx-auto grid w-full max-w-3xl justify-items-start gap-3 px-4 py-10 md:px-8"
    >
      <h1 className="text-2xl font-semibold tracking-tight">
        Algo deu errado ao carregar esta tela.
      </h1>
      <p className="text-muted-foreground">
        Pode ter sido a conexão. Tente de novo; se continuar, volte para o início.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button className="h-10" onClick={() => retry()}>
          Tentar de novo
        </Button>
        <Button asChild variant="outline" className="h-10">
          <Link href="/">Ir para o início</Link>
        </Button>
      </div>
    </div>
  );
}
