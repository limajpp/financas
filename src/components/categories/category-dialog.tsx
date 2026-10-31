"use client";

import { useId, useState, useTransition } from "react";

import {
  type CategoryActionResult,
  createCategoryAction,
  updateCategoryAction,
} from "@/app/(app)/configuracoes/categorias/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { COLOR_CLASSES, ColorPicker } from "@/components/palette";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX,
  type CategoryIcon as IconName,
  type CategoryType,
} from "@/domain/categories";
import type { PaletteColor } from "@/domain/palette";
import { cn } from "@/lib/utils";

import { ICON_COMPONENTS, ICON_LABELS } from "./category-icon";
import type { CategoryView } from "./types";

export type DialogState =
  | { mode: "create"; type: CategoryType; parent: CategoryView | null }
  | { mode: "edit"; category: CategoryView; parent: CategoryView | null };

/** Create or edit a category. Opens as a bottom sheet on phones, centered on larger screens. */
export function CategoryDialog({
  state,
  onClose,
}: {
  state: DialogState | null;
  onClose: () => void;
}) {
  // Keeps the last form on screen while the sheet animates out, instead of flashing empty.
  const [shown, setShown] = useState(state);
  if (state && state !== shown) setShown(state);

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {/* key: a fresh form (and fresh defaults) each time the dialog opens for something else. */}
        {shown && <CategoryForm key={formKey(shown)} state={shown} onDone={onClose} />}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

function formKey(state: DialogState) {
  return state.mode === "edit"
    ? `edit-${state.category.id}`
    : `create-${state.type}-${state.parent?.id ?? "root"}`;
}

function CategoryForm({ state, onDone }: { state: DialogState; onDone: () => void }) {
  const editing = state.mode === "edit" ? state.category : null;
  const parent = state.parent;
  const type = editing?.type ?? (state.mode === "create" ? state.type : "EXPENSE");

  const [name, setName] = useState(editing?.name ?? "");
  const [icon, setIcon] = useState<IconName>(
    (editing?.icon as IconName) ?? (parent?.icon as IconName) ?? "Tag",
  );
  const [color, setColor] = useState<PaletteColor>(
    (editing?.color as PaletteColor) ?? (parent?.color as PaletteColor) ?? "blue",
  );
  const [isFixed, setIsFixed] = useState(editing?.isFixed ?? false);
  const [result, setResult] = useState<CategoryActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const ids = { name: useId(), fixed: useId(), icon: useId() };

  const title = editing
    ? `Editar ${editing.name}`
    : parent
      ? `Nova subcategoria em ${parent.name}`
      : type === "EXPENSE"
        ? "Nova categoria de despesa"
        : "Nova categoria de receita";

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const appearance = { name, icon, color, isFixed };
      const response = editing
        ? await updateCategoryAction(editing.id, appearance)
        : await createCategoryAction({ ...appearance, type, parentId: parent?.id ?? null });
      setResult(response);
      if (response.ok) onDone();
    });
  }

  const fieldErrors = result && !result.ok ? result.fieldErrors : undefined;
  const nameError = fieldErrors?.name;
  const formError = result && !result.ok && !nameError ? result.error : null;

  return (
    <form onSubmit={submit} className="grid gap-5" noValidate>
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="sr-only">Nome, ícone e cor da categoria.</DialogDescription>
      </DialogHeader>

      <div className="grid gap-2">
        <Label htmlFor={ids.name}>Nome</Label>
        <Input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={CATEGORY_NAME_MAX}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? `${ids.name}-error` : undefined}
        />
        {nameError && (
          <p id={`${ids.name}-error`} className="text-sm text-destructive">
            {nameError}
          </p>
        )}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium" id={ids.icon}>
          Ícone
        </legend>
        <div role="radiogroup" aria-labelledby={ids.icon} className="grid grid-cols-8 gap-1.5">
          {CATEGORY_ICONS.map((name) => {
            const Icon = ICON_COMPONENTS[name];
            const selected = icon === name;
            return (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={ICON_LABELS[name]}
                onClick={() => setIcon(name)}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-md border outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  selected
                    ? cn(COLOR_CLASSES[color].tint, COLOR_CLASSES[color].ink, "border-current")
                    : "border-transparent text-muted-foreground hover:bg-muted",
                )}
              >
                <Icon aria-hidden className="size-4" />
              </button>
            );
          })}
        </div>
      </fieldset>

      <ColorPicker value={color} onChange={setColor} />

      {type === "EXPENSE" && (
        <div className="flex items-start justify-between gap-4">
          <div className="grid gap-1">
            <Label htmlFor={ids.fixed}>Gasto fixo</Label>
            <p className="text-sm text-muted-foreground">
              {parent?.isFixed
                ? `Já é fixa porque ${parent.name} é fixa.`
                : `Conta como fixo no indicador de fixos × variáveis${parent ? "." : ", junto com as subcategorias."}`}
            </p>
          </div>
          <Switch id={ids.fixed} checked={isFixed} onCheckedChange={setIsFixed} />
        </div>
      )}

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}

      <ResponsiveDialogFooter>
        <Button type="submit" disabled={pending} className="h-10 w-full sm:w-auto">
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
