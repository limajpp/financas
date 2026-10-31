import type { Metadata } from "next";
import Link from "next/link";

import { SignOutButton } from "@/components/nav/sign-out-button";
import { PagePlaceholder } from "@/components/page-placeholder";

export const metadata: Metadata = { title: "Configurações · Finanças" };

// On mobile the analysis pages aren't in the bottom bar yet, so they're reachable from here.
const moreLinks = [
  { href: "/faturas", label: "Faturas" },
  { href: "/assinaturas", label: "Assinaturas" },
  { href: "/estabelecimentos", label: "Estabelecimentos" },
];

export default function ConfiguracoesPage() {
  return (
    <PagePlaceholder title="Configurações">
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
    </PagePlaceholder>
  );
}
