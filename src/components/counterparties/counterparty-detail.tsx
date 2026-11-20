"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  mergeCounterpartiesAction,
  mergePreviewAction,
  updateCounterpartyAction,
} from "@/app/(app)/estabelecimentos/actions";
import { CategoryIcon } from "@/components/categories/category-icon";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { describeItem } from "@/components/transactions/describe-item";
import { TransactionEditDialog } from "@/components/transactions/transaction-edit-dialog";
import type { ListItemView, ListOptions } from "@/components/transactions/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type Period, cleanAliases } from "@/domain/counterparties";
import { ALIAS_MAX, MAX_ALIASES } from "@/domain/counterparty-memory";
import { searchCounterparties } from "@/domain/counterparty-search";
import { type CalendarDate, formatCalendarDate } from "@/domain/dates";
import { formatDocument } from "@/domain/document";
import { formatBRL } from "@/domain/money";
import { COUNTERPARTY_NAME_MAX, DESCRIPTION_MAX } from "@/domain/transactions";
import { FILTER_PARAMS } from "@/lib/transaction-filter-params";
import { cn } from "@/lib/utils";
import type { CounterpartyDetail } from "@/server/counterparties";

import { PeriodSelect } from "./period-select";

const failed = "Não foi possível salvar. Verifique a conexão e tente de novo.";

/** One counterparty (task 20): its numbers in the period, its entries, and its memory. */
export function CounterpartyDetailView({
  detail,
  period,
  options,
  today,
}: {
  detail: CounterpartyDetail;
  period: Period;
  options: ListOptions;
  today: CalendarDate;
}) {
  const { counterparty, range } = detail;
  const [editing, setEditing] = useState<ListItemView | null>(null);
  const [dialog, setDialog] = useState<"memory" | "merge" | null>(null);
  const all = `/lancamentos?${new URLSearchParams({
    [FILTER_PARAMS.counterpartyId]: counterparty.id,
    [FILTER_PARAMS.from]: range.from,
    [FILTER_PARAMS.to]: range.to,
  })}`;

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{counterparty.name}</h1>
        {counterparty.document && (
          <p className="text-sm text-muted-foreground">
            CPF/CNPJ {formatDocument(counterparty.document)}
          </p>
        )}
        {counterparty.aliases.length > 0 && (
          <p className="text-sm text-muted-foreground">
            No extrato: {counterparty.aliases.join(" · ")}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" className="h-10" onClick={() => setDialog("memory")}>
            Editar
          </Button>
          <Button variant="ghost" className="h-10" onClick={() => setDialog("merge")}>
            Mesclar com…
          </Button>
        </div>
      </header>

      <PeriodSelect period={period} path={`/estabelecimentos/${counterparty.id}`} />

      <section aria-label="Números do período" className="rounded-xl border p-4">
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Total" value={formatBRL(detail.totalCents)} strong />
          <Stat label="Compras" value={String(detail.purchases)} />
          <Stat
            label="Ticket médio"
            value={detail.averageCents === null ? "—" : formatBRL(detail.averageCents)}
          />
        </dl>
      </section>

      <section aria-labelledby="counterparty-entries">
        <h2 id="counterparty-entries" className="text-lg font-semibold tracking-tight">
          Lançamentos
        </h2>
        {detail.items.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">Nenhum lançamento neste período.</p>
        ) : (
          <ul aria-labelledby="counterparty-entries" className="mt-2 divide-y rounded-lg border">
            {detail.items.map((item) => (
              <EntryRow key={item.id} item={item} onOpen={() => setEditing(item)} />
            ))}
          </ul>
        )}
        <Link
          href={all}
          className="mt-2 inline-block text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          Ver todos os lançamentos
        </Link>
      </section>

      <TransactionEditDialog
        item={editing}
        options={options}
        today={today}
        onClose={() => setEditing(null)}
      />
      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <ResponsiveDialogContent>
          {dialog === "memory" && (
            <MemoryForm detail={detail} options={options} onDone={() => setDialog(null)} />
          )}
          {dialog === "merge" && (
            <MergeForm detail={detail} options={options} onDone={() => setDialog(null)} />
          )}
        </ResponsiveDialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate tabular-nums",
          strong ? "text-xl font-semibold tracking-tight" : "pt-1",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function EntryRow({ item, onOpen }: { item: ListItemView; onOpen: () => void }) {
  const { line, amount } = describeItem(item);
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50"
      >
        {item.category ? (
          <CategoryIcon icon={item.category.icon} color={item.category.color} className="size-8" />
        ) : (
          <span aria-hidden className="size-8 shrink-0 rounded-lg bg-muted" />
        )}
        <span className="grid min-w-0 flex-1">
          <span className="truncate font-medium">{formatCalendarDate(item.date)}</span>
          <span className="truncate text-xs text-muted-foreground">
            {[item.category?.name, line].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            item.type === "INCOME" && "text-emerald-700 dark:text-emerald-400",
          )}
        >
          {amount}
        </span>
      </button>
    </li>
  );
}

function MemoryForm({
  detail,
  options,
  onDone,
}: {
  detail: CounterpartyDetail;
  options: ListOptions;
  onDone: () => void;
}) {
  const { counterparty } = detail;
  const ids = {
    name: useId(),
    alias: useId(),
    document: useId(),
    category: useId(),
    description: useId(),
  };
  const [name, setName] = useState(counterparty.name);
  const [aliases, setAliases] = useState(counterparty.aliases);
  const [alias, setAlias] = useState("");
  const [document, setDocument] = useState(
    counterparty.document ? formatDocument(counterparty.document) : "",
  );
  const [categoryId, setCategoryId] = useState(counterparty.defaultCategoryId ?? "");
  const [description, setDescription] = useState(counterparty.defaultDescription ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const trees = [
    ["Despesas", options.categories.EXPENSE],
    ["Receitas", options.categories.INCOME],
  ] as const;
  const knownCategory = trees.some(([, tree]) =>
    tree.some((p) => p.id === categoryId || p.children.some((c) => c.id === categoryId)),
  );

  function addAlias() {
    const value = alias.trim();
    if (value === "" || aliases.length >= MAX_ALIASES) return;
    // A repeat, or the name itself, isn't another alias (the server drops them too).
    setAliases((current) => cleanAliases(name, [...current, value]));
    setAlias("");
  }

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const pendingAlias = alias.trim();
    startTransition(async () => {
      try {
        const result = await updateCounterpartyAction(counterparty.id, {
          name,
          aliases: pendingAlias ? [...aliases, pendingAlias] : aliases,
          document,
          defaultCategoryId: categoryId,
          defaultDescription: description,
        });
        if (!result.ok) return setError(result.error);
      } catch {
        return setError(failed);
      }
      toast("Estabelecimento atualizado");
      onDone();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Editar {counterparty.name}</DialogTitle>
        <DialogDescription>
          O que o registro sugere para este estabelecimento. Os lançamentos já feitos não mudam.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.name}>Nome</Label>
        <Input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={COUNTERPARTY_NAME_MAX}
          autoComplete="off"
        />
      </div>

      <fieldset className="grid gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Nomes no extrato</legend>
        {aliases.length > 0 && (
          <ul aria-label="Nomes no extrato" className="flex flex-wrap gap-2">
            {aliases.map((a, index) => (
              <li
                key={`${a}:${index}`}
                className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-3 text-sm"
              >
                {a}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remover ${a}`}
                  onClick={() => setAliases((current) => current.filter((_, i) => i !== index))}
                >
                  <X aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <Input
            id={ids.alias}
            aria-label="Novo nome no extrato"
            placeholder="Ex.: PAG*PADARIA"
            value={alias}
            onChange={(e) => setAlias(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addAlias();
              }
            }}
            maxLength={ALIAS_MAX}
            autoComplete="off"
          />
          <Button
            type="button"
            variant="outline"
            className="h-9"
            disabled={aliases.length >= MAX_ALIASES}
            onClick={addAlias}
          >
            Adicionar
          </Button>
        </div>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.document}>CPF/CNPJ</Label>
        <Input
          id={ids.document}
          value={document}
          onChange={(e) => setDocument(e.target.value)}
          maxLength={40}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.category}>Categoria padrão</Label>
        <NativeSelect
          id={ids.category}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Aprender com os lançamentos</option>
          {trees.map(([label, tree]) =>
            tree.map((parent) => (
              <optgroup key={parent.id} label={`${label} · ${parent.name}`}>
                <option value={parent.id}>{parent.name}</option>
                {parent.children.map((child) => (
                  <option key={child.id} value={child.id}>
                    {child.name}
                  </option>
                ))}
              </optgroup>
            )),
          )}
          {categoryId && !knownCategory && <option value={categoryId}>(arquivada)</option>}
        </NativeSelect>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.description}>Observação padrão</Label>
        <Input
          id={ids.description}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={DESCRIPTION_MAX}
          autoComplete="off"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
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

type Preview = Extract<Awaited<ReturnType<typeof mergePreviewAction>>, { ok: true }>;

function MergeForm({
  detail,
  options,
  onDone,
}: {
  detail: CounterpartyDetail;
  options: ListOptions;
  onDone: () => void;
}) {
  const { counterparty } = detail;
  const searchId = useId();
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<(Preview & { absorbedId: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const others = options.counterparties.filter((c) => c.id !== counterparty.id);
  const results = searchCounterparties(query, others, 6);

  function choose(absorbedId: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await mergePreviewAction(counterparty.id, absorbedId);
        if (!result.ok) return setError(result.error);
        setPreview({ ...result, absorbedId });
      } catch {
        setError("Não foi possível carregar. Verifique a conexão e tente de novo.");
      }
    });
  }

  function merge() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await mergeCounterpartiesAction(counterparty.id, preview.absorbedId);
        if (!result.ok) return setError(result.error);
      } catch {
        return setError(failed);
      }
      toast("Estabelecimentos mesclados");
      onDone();
    });
  }

  if (preview) {
    const moving = [
      preview.entries === 1 ? "O lançamento" : `Os ${preview.entries} lançamentos`,
      preview.subscriptions === 0
        ? null
        : preview.subscriptions === 1
          ? "a assinatura"
          : `as ${preview.subscriptions} assinaturas`,
    ]
      .filter(Boolean)
      .join(" e ");
    return (
      <div className="grid gap-4">
        <DialogHeader>
          <DialogTitle>Mesclar com {preview.absorbedName}?</DialogTitle>
          <DialogDescription>Não dá para desfazer.</DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {preview.entries > 0 || preview.subscriptions > 0
            ? `${moving} de “${preview.absorbedName}” ${
                preview.entries + preview.subscriptions === 1 ? "passa" : "passam"
              } para “${preview.keepName}”. `
            : ""}
          “{preview.absorbedName}” vira um nome no extrato e deixa de existir.
        </p>
        {preview.documentDropped && (
          <p className="text-sm text-amber-800 dark:text-amber-300">
            O CPF/CNPJ de “{preview.absorbedName}” ({formatDocument(preview.documentDropped)}) será
            descartado.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <ResponsiveDialogFooter className="gap-2">
          <Button
            variant="ghost"
            className="h-10"
            disabled={pending}
            onClick={() => setPreview(null)}
          >
            Voltar
          </Button>
          <Button variant="destructive" className="h-10" disabled={pending} onClick={merge}>
            Mesclar
          </Button>
        </ResponsiveDialogFooter>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Mesclar com…</DialogTitle>
        <DialogDescription>
          Escolha o estabelecimento que é o mesmo que “{counterparty.name}”. Ele é absorvido por
          este.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-1.5">
        <Label htmlFor={searchId}>Buscar</Label>
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
        />
      </div>
      <ul aria-label="Estabelecimentos" className="divide-y rounded-lg border">
        {results.length === 0 ? (
          <li className="px-3 py-3 text-sm text-muted-foreground">
            Nenhum estabelecimento encontrado.
          </li>
        ) : (
          results.map(({ counterparty: other }) => (
            <li key={other.id}>
              <button
                type="button"
                disabled={pending}
                onClick={() => choose(other.id)}
                className="flex min-h-11 w-full items-center px-3 text-left hover:bg-muted/50"
              >
                {other.name}
              </button>
            </li>
          ))
        )}
      </ul>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
