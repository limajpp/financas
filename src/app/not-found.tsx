import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Página não encontrada · Finanças" };

/**
 * An address the app doesn't have (task 26). Rendered for every unmatched URL, in the root layout
 * (without the navigation): a server component with a link only, as Next asks of the root one.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="text-muted-foreground">Esse endereço não existe no app.</p>
      <Link
        href="/"
        className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
      >
        Ir para o início
      </Link>
    </main>
  );
}
