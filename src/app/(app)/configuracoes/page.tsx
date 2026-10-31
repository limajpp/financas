import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { SignOutButton } from "@/components/nav/sign-out-button";

export const metadata: Metadata = { title: "Configurações · Finanças" };

const settingsLinks = [
  { href: "/contas", label: "Contas" },
  { href: "/configuracoes/categorias", label: "Categorias" },
];

// On mobile the analysis pages aren't in the bottom bar yet, so they're reachable from here.
const moreLinks = [
  { href: "/faturas", label: "Faturas" },
  { href: "/assinaturas", label: "Assinaturas" },
  { href: "/estabelecimentos", label: "Estabelecimentos" },
];

export default function ConfiguracoesPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Configurações</h1>
      <nav aria-label="Ajustes" className="mt-6">
        <ul className="divide-y rounded-md border">
          {settingsLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="flex items-center justify-between px-4 py-3">
                {link.label}
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <nav aria-label="Mais telas" className="mt-6 md:hidden">
        <ul className="divide-y rounded-md border">
          {moreLinks.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="block px-4 py-3">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <SignOutButton className="mt-6 md:hidden" />
    </div>
  );
}
