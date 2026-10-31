import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CategoryManager } from "@/components/categories/category-manager";
import type { CategoryView } from "@/components/categories/types";
import { listCategories } from "@/server/categories";
import { getCurrentSpace } from "@/server/session";

export const metadata: Metadata = { title: "Categorias · Finanças" };

export default function CategoriasPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-8 md:py-10">
      <Link
        href="/configuracoes"
        className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft aria-hidden className="size-4" />
        Configurações
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">Categorias</h1>
      <p className="mt-2 text-muted-foreground">
        Organize seus gastos e receitas. Arquivar tira a categoria das escolhas, mas os lançamentos
        antigos continuam com ela.
      </p>
      <Suspense fallback={<p className="mt-6 text-muted-foreground">Carregando categorias…</p>}>
        <Categories />
      </Suspense>
    </div>
  );
}

async function Categories() {
  const space = await getCurrentSpace();
  const tree = await listCategories(space.id, { includeArchived: true });
  const toView = (c: (typeof tree)[number] | (typeof tree)[number]["children"][number]) => ({
    id: c.id,
    parentId: c.parentId,
    name: c.name,
    type: c.type,
    icon: c.icon,
    color: c.color,
    isFixed: c.isFixed,
    archived: c.archivedAt !== null,
  });
  const categories: CategoryView[] = tree.map((parent) => ({
    ...toView(parent),
    children: parent.children.map((child) => ({ ...toView(child), children: [] })),
  }));
  return <CategoryManager categories={categories} />;
}
