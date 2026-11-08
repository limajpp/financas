"use client";

import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import { bulkSetCategoryAction, listMoreTransactionsAction } from "@/app/(app)/lancamentos/actions";
import { CategoryIcon } from "@/components/categories/category-icon";
import { NativeSelect } from "@/components/native-select";
import { ResponsiveDialogContent } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type CalendarDate, formatCalendarDate } from "@/domain/dates";
import { formatBRL } from "@/domain/money";
import { addMonthsToMonth } from "@/domain/recurring";
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  TRANSACTION_DATE_MIN,
} from "@/domain/transactions";
import {
  type TransactionFilters,
  activeFilterCount,
  filtersToParams,
  monthRange,
} from "@/lib/validation/transaction-filters";
import { cn } from "@/lib/utils";

import { TYPE_LABELS, describeItem } from "./describe-item";
import { TransactionEditDialog } from "./transaction-edit-dialog";
import type { ListItemView, ListOptions, ListPageView } from "./types";

const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
const monthName = new Intl.DateTimeFormat("pt-BR", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/** "Sexta, 07/11". */
function dayLabel(date: CalendarDate) {
  const name = weekday.format(new Date(`${date}T00:00:00Z`)).replace("-feira", "");
  return `${name[0]!.toUpperCase()}${name.slice(1)}, ${formatCalendarDate(date).slice(0, 5)}`;
}

/** The period's name: "novembro de 2026" for a whole month, else "01/10 – 15/10". */
function periodLabel(filters: TransactionFilters) {
  const month = monthRange(filters.from);
  if (filters.from === month.from && filters.to === month.to) {
    return monthName.format(new Date(`${filters.from}T00:00:00Z`));
  }
  return `${formatCalendarDate(filters.from)} – ${formatCalendarDate(filters.to)}`;
}

const selectable = (item: ListItemView) => item.type === "EXPENSE" || item.type === "INCOME";

export function TransactionList({
  filters,
  today,
  initialPage,
  options,
}: {
  filters: TransactionFilters;
  today: CalendarDate;
  initialPage: ListPageView;
  options: ListOptions;
}) {
  const [page, setPage] = useState(initialPage);
  const [items, setItems] = useState(initialPage.items);
  const [dayTotals, setDayTotals] = useState(initialPage.dayTotals);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  // After an edit the server sends a fresh first page (same filters): start over from it.
  if (page !== initialPage) {
    setPage(initialPage);
    setItems(initialPage.items);
    setDayTotals(initialPage.dayTotals);
    setCursor(initialPage.nextCursor);
  }
  const [loading, startLoading] = useTransition();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [selecting, setSelecting] = useState(false);
  const [editing, setEditing] = useState<ListItemView | null>(null);
  const apply = useApplyFilters();

  function loadMore() {
    if (!cursor || loading) return;
    startLoading(async () => {
      const result = await listMoreTransactionsAction(
        Object.fromEntries(filtersToParams(filters)),
        cursor,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setItems((current) => [...current, ...result.page.items]);
      setDayTotals((current) => ({ ...current, ...result.page.dayTotals }));
      setCursor(result.page.nextCursor);
    });
  }

  // More entries load by themselves at the end of the list. A ref callback: the sentinel only
  // exists while there are entries, and they may arrive after the first render.
  const loadMoreRef = useRef(loadMore);
  useEffect(() => {
    loadMoreRef.current = loadMore;
  });
  const sentinel = useCallback((element: HTMLDivElement | null) => {
    if (!element) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectableItems = items.filter(selectable);
  const allSelected =
    selectableItems.length > 0 && selectableItems.every((i) => selected.has(i.id));
  const days = [...new Set(items.map((i) => i.date))];
  const filtered = activeFilterCount(filters) > 0 || filters.q !== undefined;

  return (
    <div className="grid gap-4">
      {items.length === 0 ? (
        <div className="grid justify-items-start gap-3 py-6">
          <p className="text-muted-foreground">Nenhum lançamento neste período.</p>
          {filtered && (
            <Button variant="outline" onClick={() => apply({ from: filters.from, to: filters.to })}>
              Limpar filtros
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between md:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelecting((s) => !s);
                setSelected(new Set());
              }}
            >
              {selecting ? "Cancelar seleção" : "Selecionar"}
            </Button>
          </div>

          {/* Phone: grouped by day. */}
          <div className="grid gap-4 md:hidden">
            {days.map((date) => (
              <section key={date} aria-label={dayLabel(date)}>
                <h2 className="flex items-baseline justify-between px-1 pb-1 text-sm font-medium text-muted-foreground">
                  <span>{dayLabel(date)}</span>
                  <span className="tabular-nums">{formatBRL(dayTotals[date] ?? 0)}</span>
                </h2>
                <ul className="divide-y rounded-lg border">
                  {items
                    .filter((i) => i.date === date)
                    .map((item) => (
                      <PhoneRow
                        key={item.id}
                        item={item}
                        selecting={selecting}
                        selected={selected.has(item.id)}
                        onToggle={() => toggle(item.id)}
                        onOpen={() => setEditing(item)}
                      />
                    ))}
                </ul>
              </section>
            ))}
          </div>

          {/* Computer: a table. */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos"
                      checked={allSelected}
                      disabled={selectableItems.length === 0}
                      onChange={() =>
                        setSelected(
                          allSelected ? new Set() : new Set(selectableItems.map((i) => i.id)),
                        )
                      }
                    />
                  </th>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 font-medium">Categoria</th>
                  <th className="px-3 py-2 font-medium">Conta ou cartão</th>
                  <th className="px-3 py-2 font-medium">Forma</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {items.map((item) => {
                  const { title, place, method, amount } = describeItem(item);
                  return (
                    <tr
                      key={item.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => setEditing(item)}
                    >
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        {selectable(item) && (
                          <input
                            type="checkbox"
                            aria-label={`Selecionar ${title}`}
                            checked={selected.has(item.id)}
                            onChange={() => toggle(item.id)}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {formatCalendarDate(item.date)}
                      </td>
                      <td className="max-w-64 px-3 py-2">
                        <button
                          type="button"
                          className="block max-w-full truncate text-left font-medium hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditing(item);
                          }}
                        >
                          {title}
                        </button>
                      </td>
                      <td className="px-3 py-2">{categoryName(item)}</td>
                      <td className="px-3 py-2 text-muted-foreground">
                        {place}
                        {item.recurringRuleId && " · Assinatura"}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">{method}</td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right whitespace-nowrap tabular-nums",
                          amountClass(item),
                        )}
                      >
                        {amount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div ref={sentinel} />
          {cursor && (
            <Button
              variant="outline"
              className="justify-self-center"
              disabled={loading}
              onClick={loadMore}
            >
              {loading ? "Carregando…" : "Carregar mais"}
            </Button>
          )}
        </>
      )}

      {selected.size > 0 && (
        <BulkBar
          hasMore={cursor !== null}
          items={items.filter((i) => selected.has(i.id))}
          options={options}
          onDone={(ids, category) => {
            // Show the new category at once; the server's refresh confirms it.
            setItems((current) =>
              current.map((i) => (ids.includes(i.id) ? { ...i, category } : i)),
            );
            setSelected(new Set());
            setSelecting(false);
          }}
          onCancel={() => setSelected(new Set())}
        />
      )}

      <TransactionEditDialog
        item={editing}
        options={options}
        today={today}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}

function categoryName(item: ListItemView) {
  if (item.type !== "EXPENSE" && item.type !== "INCOME")
    return <span className="text-muted-foreground">—</span>;
  if (!item.category) return <span className="text-muted-foreground">Sem categoria</span>;
  return (
    <span className="flex items-center gap-2">
      <CategoryIcon icon={item.category.icon} color={item.category.color} className="size-6" />
      {item.category.name}
    </span>
  );
}

function amountClass(item: ListItemView) {
  return item.type === "INCOME" ? "text-emerald-700 dark:text-emerald-400" : undefined;
}

function PhoneRow({
  item,
  selecting,
  selected,
  onToggle,
  onOpen,
}: {
  item: ListItemView;
  selecting: boolean;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const { title, line, amount } = describeItem(item);
  const canSelect = selecting && selectable(item);
  return (
    <li>
      <button
        type="button"
        aria-pressed={canSelect ? selected : undefined}
        aria-label={canSelect ? `Selecionar ${title}` : undefined}
        onClick={canSelect ? onToggle : selecting ? undefined : onOpen}
        disabled={selecting && !selectable(item)}
        className={cn(
          "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left disabled:opacity-50",
          selected && "bg-primary/5",
        )}
      >
        {canSelect && (
          <input
            type="checkbox"
            readOnly
            checked={selected}
            tabIndex={-1}
            aria-hidden
            className="shrink-0"
          />
        )}
        {item.category ? (
          <CategoryIcon icon={item.category.icon} color={item.category.color} className="size-8" />
        ) : (
          <span aria-hidden className="size-8 shrink-0 rounded-lg bg-muted" />
        )}
        <span className="grid min-w-0 flex-1">
          <span className="truncate font-medium">{title}</span>
          <span className="truncate text-xs text-muted-foreground">{line}</span>
        </span>
        <span className={cn("shrink-0 tabular-nums", amountClass(item))}>{amount}</span>
      </button>
    </li>
  );
}

/** Filters go to the URL; the server renders the list for them. */
function useApplyFilters() {
  const router = useRouter();
  const pathname = usePathname();
  return (next: TransactionFilters) => {
    const query = filtersToParams(next).toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };
}

/**
 * Period, search and filters. Outside the list's key, so typing a search doesn't remount it (and
 * lose the focus) when the URL changes.
 */
export function TransactionFiltersBar({
  filters: fromUrl,
  options,
}: {
  filters: TransactionFilters;
  options: ListOptions;
}) {
  const navigate = useApplyFilters();
  const [sheetOpen, setSheetOpen] = useState(false);
  // The filters as the bar last set them. A navigation takes a moment to come back as props, and
  // a change made meanwhile (another select, more letters in the search) must build on this, not
  // on the props, or it would undo the previous one.
  const [filters, setFilters] = useState(fromUrl);
  const [q, setQ] = useState(fromUrl.q ?? "");
  const [pushed, setPushed] = useState(() => filtersToParams(fromUrl).toString());
  const [seen, setSeen] = useState(fromUrl);
  if (seen !== fromUrl) {
    setSeen(fromUrl);
    // The URL changed elsewhere ("Limpar filtros", back button): follow it.
    if (filtersToParams(fromUrl).toString() !== pushed) {
      setPushed(filtersToParams(fromUrl).toString());
      setFilters(fromUrl);
      setQ(fromUrl.q ?? "");
    }
  }

  const onApply = (next: TransactionFilters) => {
    setPushed(filtersToParams(next).toString());
    setFilters(next);
    navigate(next);
  };
  const set = (patch: Partial<TransactionFilters>) => onApply({ ...filters, ...patch });

  // The search goes to the URL a moment after typing stops.
  const latest = useRef({ filters, onApply });
  useEffect(() => {
    latest.current = { filters, onApply };
  });
  useEffect(() => {
    const value = q.trim() || undefined;
    if (value === latest.current.filters.q) return;
    const timer = setTimeout(
      () => latest.current.onApply({ ...latest.current.filters, q: value }),
      350,
    );
    return () => clearTimeout(timer);
  }, [q]);

  const month = filters.from.slice(0, 7);
  const shift = (n: number) => {
    const next = addMonthsToMonth(month, n);
    set(monthRange(`${next}-01`));
  };
  const count = activeFilterCount(filters);

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" size="icon" aria-label="Mês anterior" onClick={() => shift(-1)}>
          <ChevronLeft aria-hidden />
        </Button>
        <p className="text-center font-medium first-letter:uppercase" aria-live="polite">
          {periodLabel(filters)}
        </p>
        <Button variant="ghost" size="icon" aria-label="Próximo mês" onClick={() => shift(1)}>
          <ChevronRight aria-hidden />
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="busca" className="sr-only">
          Buscar
        </Label>
        <Input
          id="busca"
          type="search"
          placeholder="Buscar: estabelecimento, observação ou valor"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={60}
          className="flex-1"
        />
        <Button variant="outline" className="gap-2 md:hidden" onClick={() => setSheetOpen(true)}>
          <SlidersHorizontal aria-hidden />
          Filtros{count > 0 ? ` (${count})` : ""}
        </Button>
      </div>
      <div className="hidden md:block">
        <FilterFields filters={filters} options={options} onApply={set} inline />
      </div>

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <ResponsiveDialogContent>
          <DialogHeader>
            <DialogTitle>Filtros</DialogTitle>
            <DialogDescription className="sr-only">
              Escolha o que mostrar na lista.
            </DialogDescription>
          </DialogHeader>
          <FilterFields filters={filters} options={options} onApply={set} />
          <Button
            variant="outline"
            onClick={() => onApply({ from: filters.from, to: filters.to, q: filters.q })}
          >
            Limpar filtros
          </Button>
        </ResponsiveDialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A date input's value once the year is complete: while a year is typed the input reports
 * values like 0002-10-01, and each would reload the list.
 */
function typedDate(value: string) {
  return value !== "" && value >= TRANSACTION_DATE_MIN;
}

function FilterFields({
  filters,
  options,
  onApply: set,
  inline = false,
}: {
  filters: TransactionFilters;
  options: ListOptions;
  /** Applies a change on top of the bar's latest filters. */
  onApply: (patch: Partial<TransactionFilters>) => void;
  inline?: boolean;
}) {
  const value = (v: string) => (v === "" ? undefined : v);
  const field = (label: string, control: React.ReactNode) => (
    <label className="grid gap-1 text-sm">
      <span className={inline ? "sr-only" : undefined}>{label}</span>
      {control}
    </label>
  );
  const archived = (name: string, isArchived: boolean) =>
    isArchived ? `${name} (arquivada)` : name;
  return (
    <div className={cn("grid gap-3", inline ? "grid-cols-3 lg:grid-cols-4" : "grid-cols-1")}>
      {field(
        "Conta",
        <NativeSelect
          aria-label="Conta"
          value={filters.accountId ?? ""}
          onChange={(e) => set({ accountId: value(e.target.value) })}
        >
          <option value="">Todas as contas</option>
          {options.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.archived ? `${a.name} (arquivada)` : a.name}
            </option>
          ))}
        </NativeSelect>,
      )}
      {field(
        "Cartão",
        <NativeSelect
          aria-label="Cartão"
          value={filters.cardId ?? ""}
          onChange={(e) => set({ cardId: value(e.target.value) })}
        >
          <option value="">Todos os cartões</option>
          {options.cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.archived ? `${c.name} (arquivado)` : c.name}
            </option>
          ))}
        </NativeSelect>,
      )}
      {field(
        "Forma de pagamento",
        <NativeSelect
          aria-label="Forma de pagamento"
          value={filters.method ?? ""}
          onChange={(e) => set({ method: value(e.target.value) as TransactionFilters["method"] })}
        >
          <option value="">Todas as formas</option>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </NativeSelect>,
      )}
      {field(
        "Categoria",
        <NativeSelect
          aria-label="Categoria"
          value={filters.categoryId ?? ""}
          onChange={(e) => set({ categoryId: value(e.target.value) })}
        >
          <option value="">Todas as categorias</option>
          <option value="none">Sem categoria</option>
          {options.filterCategories.map((parent) => (
            <optgroup key={parent.id} label={archived(parent.name, parent.archived)}>
              <option value={parent.id}>{archived(parent.name, parent.archived)} (todas)</option>
              {parent.children.map((child) => (
                <option key={child.id} value={child.id}>
                  {archived(child.name, child.archived)}
                </option>
              ))}
            </optgroup>
          ))}
        </NativeSelect>,
      )}
      {field(
        "Estabelecimento",
        <NativeSelect
          aria-label="Estabelecimento"
          value={filters.counterpartyId ?? ""}
          onChange={(e) => set({ counterpartyId: value(e.target.value) })}
        >
          <option value="">Todos os estabelecimentos</option>
          {options.filterCounterparty && (
            <option value={options.filterCounterparty.id}>{options.filterCounterparty.name}</option>
          )}
          {[...options.counterparties]
            .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </NativeSelect>,
      )}
      {field(
        "Tipo",
        <NativeSelect
          aria-label="Tipo"
          value={filters.type ?? ""}
          onChange={(e) => set({ type: value(e.target.value) as TransactionFilters["type"] })}
        >
          <option value="">Todos os tipos</option>
          {(Object.keys(TYPE_LABELS) as (keyof typeof TYPE_LABELS)[]).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>,
      )}
      <div className={cn("grid grid-cols-2 gap-3", inline && "col-span-3 lg:col-span-2")}>
        {field(
          "De",
          <Input
            type="date"
            aria-label="De"
            value={filters.from}
            onChange={(e) => typedDate(e.target.value) && set({ from: e.target.value })}
          />,
        )}
        {field(
          "Até",
          <Input
            type="date"
            aria-label="Até"
            value={filters.to}
            onChange={(e) => typedDate(e.target.value) && set({ to: e.target.value })}
          />,
        )}
      </div>
    </div>
  );
}

function BulkBar({
  hasMore,
  items,
  options,
  onDone,
  onCancel,
}: {
  hasMore: boolean;
  items: ListItemView[];
  options: ListOptions;
  onDone: (ids: string[], category: ListItemView["category"]) => void;
  onCancel: () => void;
}) {
  const types = new Set(items.map((i) => i.type));
  const type = types.size === 1 ? ([...types][0] as "EXPENSE" | "INCOME") : null;
  const [categoryId, setCategoryId] = useState("none");
  // Another type of selection: a category chosen for the previous one doesn't fit.
  const [seenType, setSeenType] = useState(type);
  if (seenType !== type) {
    setSeenType(type);
    setCategoryId("none");
  }
  const [pending, startTransition] = useTransition();

  function applyCategory() {
    startTransition(async () => {
      const result = await bulkSetCategoryAction(
        items.map((i) => i.id),
        categoryId === "none" ? null : categoryId,
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast(
        `${result.count} ${result.count === 1 ? "lançamento categorizado" : "lançamentos categorizados"}`,
      );
      const chosen =
        categoryId === "none" || !type
          ? undefined
          : options.categories[type]
              .flatMap((p) => [p, ...p.children])
              .find((c) => c.id === categoryId);
      onDone(
        items.map((i) => i.id),
        chosen && type
          ? { id: chosen.id, name: chosen.name, icon: chosen.icon, color: chosen.color, type }
          : null,
      );
    });
  }

  return (
    <div
      role="region"
      aria-label="Ações em massa"
      className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-4 flex flex-wrap items-center gap-2 border-t bg-background px-4 py-3 md:bottom-0 md:mx-0 md:rounded-lg md:border"
    >
      <p className="text-sm font-medium">
        {items.length} {items.length === 1 ? "selecionado" : "selecionados"}
        {hasMore && " nesta lista"}
      </p>
      <NativeSelect
        aria-label="Nova categoria"
        value={categoryId}
        disabled={!type}
        aria-describedby={type ? undefined : "bulk-mixed"}
        onChange={(e) => setCategoryId(e.target.value)}
        className="min-w-0 flex-1 md:max-w-64"
      >
        <option value="none">Sem categoria</option>
        {type &&
          options.categories[type].map((parent) => (
            <optgroup key={parent.id} label={parent.name}>
              <option value={parent.id}>{parent.name}</option>
              {parent.children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
      </NativeSelect>
      <Button disabled={pending || !type} onClick={applyCategory}>
        {pending ? "Aplicando…" : "Aplicar"}
      </Button>
      {!type && (
        <p id="bulk-mixed" className="w-full text-sm text-muted-foreground">
          Selecione só despesas ou só receitas.
        </p>
      )}
      <Button variant="ghost" onClick={onCancel}>
        Cancelar
      </Button>
    </div>
  );
}
