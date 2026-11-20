"use client";

import { CategoryIcon } from "@/components/categories/category-icon";
import { ResponsiveDialogContent } from "@/components/responsive-dialog";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { RegisterTypeData } from "./types";

/** Every active category of the type ("Mais"). Choosing one closes the sheet. */
export function CategorySheet({
  open,
  onOpenChange,
  tree,
  selectedId,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tree: RegisterTypeData["tree"];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const option = (category: RegisterTypeData["top"][number], child = false) => (
    <li key={category.id}>
      <button
        type="button"
        aria-pressed={category.id === selectedId}
        onClick={() => onSelect(category.id)}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 rounded-lg px-2 text-left hover:bg-muted aria-pressed:bg-muted aria-pressed:font-medium",
          child && "pl-8",
        )}
      >
        <CategoryIcon icon={category.icon} color={category.color} className="size-7" />
        <span className="truncate">{category.name}</span>
      </button>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent>
        <DialogHeader>
          <DialogTitle>Categorias</DialogTitle>
          <DialogDescription className="sr-only">
            Escolha a categoria do lançamento.
          </DialogDescription>
        </DialogHeader>
        {tree.length === 0 ? (
          <p className="text-muted-foreground">Nenhuma categoria ativa desse tipo.</p>
        ) : (
          <ul aria-label="Todas as categorias" className="grid gap-0.5">
            {tree.map((parent) => [
              option(parent),
              ...parent.children.map((child) => option(child, true)),
            ])}
          </ul>
        )}
      </ResponsiveDialogContent>
    </Dialog>
  );
}
