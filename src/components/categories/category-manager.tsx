"use client";

import { Archive, ArchiveRestore, Pencil, Plus } from "lucide-react";
import { useState, useTransition } from "react";

import { setCategoryArchivedAction } from "@/app/(app)/configuracoes/categorias/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type CategoryType, isArchivedEffective, isFixedEffective } from "@/domain/categories";
import { cn } from "@/lib/utils";

import { CategoryDialog, type DialogState } from "./category-dialog";
import { CategoryIcon } from "./category-icon";
import type { CategoryView } from "./types";

const TABS: { type: CategoryType; label: string }[] = [
  { type: "EXPENSE", label: "Despesas" },
  { type: "INCOME", label: "Receitas" },
];

export function CategoryManager({ categories }: { categories: CategoryView[] }) {
  const [showArchived, setShowArchived] = useState(false);
  const [type, setType] = useState<CategoryType>("EXPENSE");
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleArchived(category: CategoryView) {
    setError(null);
    startTransition(async () => {
      const result = await setCategoryArchivedAction(category.id, !category.archived);
      if (!result.ok) setError(result.error);
    });
  }

  const visible = (list: CategoryView[]) => (showArchived ? list : list.filter((c) => !c.archived));

  return (
    <Tabs value={type} onValueChange={(value) => setType(value as CategoryType)} className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          {TABS.map((tab) => (
            <TabsTrigger key={tab.type} value={tab.type} className="px-3">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex items-center gap-2">
          <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
          <Label htmlFor="show-archived">Mostrar arquivadas</Label>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {TABS.map((tab) => {
        const parents = visible(categories.filter((c) => c.type === tab.type));
        return (
          <TabsContent key={tab.type} value={tab.type} className="mt-4">
            <Button
              className="mb-4 h-10 gap-2"
              onClick={() => setDialog({ mode: "create", type: tab.type, parent: null })}
            >
              <Plus aria-hidden />
              Nova categoria
            </Button>

            {parents.length === 0 ? (
              <p className="text-muted-foreground">Nenhuma categoria aqui.</p>
            ) : (
              <ul aria-label={`Categorias de ${tab.label.toLowerCase()}`} className="grid gap-3">
                {parents.map((parent) => (
                  <li key={parent.id} className="rounded-lg border">
                    <CategoryRow
                      category={parent}
                      disabled={pending}
                      onEdit={() => setDialog({ mode: "edit", category: parent, parent: null })}
                      onAddChild={() => setDialog({ mode: "create", type: tab.type, parent })}
                      onToggleArchived={() => toggleArchived(parent)}
                      canRestore
                    />
                    {visible(parent.children).length > 0 && (
                      <ul
                        aria-label={`Subcategorias de ${parent.name}`}
                        className="border-t py-1 pl-6"
                      >
                        {visible(parent.children).map((child) => (
                          <li key={child.id}>
                            <CategoryRow
                              category={child}
                              parent={parent}
                              disabled={pending}
                              onEdit={() => setDialog({ mode: "edit", category: child, parent })}
                              onToggleArchived={() => toggleArchived(child)}
                              // A child of an archived parent only comes back with the parent.
                              canRestore={!parent.archived}
                            />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        );
      })}

      <CategoryDialog state={dialog} onClose={() => setDialog(null)} />
    </Tabs>
  );
}

function CategoryRow({
  category,
  parent,
  disabled,
  canRestore,
  onEdit,
  onAddChild,
  onToggleArchived,
}: {
  category: CategoryView;
  parent?: CategoryView;
  disabled: boolean;
  canRestore: boolean;
  onEdit: () => void;
  onAddChild?: () => void;
  onToggleArchived: () => void;
}) {
  const toNode = (c: CategoryView) => ({ archivedAt: c.archived ? new Date(0) : null });
  // A child of an archived parent counts as archived too.
  const archived = isArchivedEffective(toNode(category), parent && toNode(parent));
  const fixed = isFixedEffective(category, parent);
  return (
    <div className={cn("flex min-h-12 items-center gap-3 px-3 py-2", archived && "opacity-60")}>
      <CategoryIcon icon={category.icon} color={category.color} />
      <span className="min-w-0 flex-1 truncate font-medium">{category.name}</span>
      {category.type === "EXPENSE" && fixed && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Fixa
        </span>
      )}
      {archived && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Arquivada
        </span>
      )}
      <div className="flex shrink-0 items-center">
        <Button variant="ghost" size="icon" aria-label={`Editar ${category.name}`} onClick={onEdit}>
          <Pencil aria-hidden />
        </Button>
        {onAddChild && !archived && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Nova subcategoria em ${category.name}`}
            onClick={onAddChild}
          >
            <Plus aria-hidden />
          </Button>
        )}
        {archived ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Desarquivar ${category.name}`}
            title={canRestore ? undefined : "Desarquive a categoria principal primeiro"}
            disabled={disabled || !canRestore}
            onClick={onToggleArchived}
          >
            <ArchiveRestore aria-hidden />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Arquivar ${category.name}`}
            disabled={disabled}
            onClick={onToggleArchived}
          >
            <Archive aria-hidden />
          </Button>
        )}
      </div>
    </div>
  );
}
