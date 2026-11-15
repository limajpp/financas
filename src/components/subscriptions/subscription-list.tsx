"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  editRecurringRuleAction,
  setRecurringRuleStatusAction,
} from "@/app/(app)/assinaturas/actions";
import { CategoryIcon } from "@/components/categories/category-icon";
import { MoneyInput } from "@/components/money-input";
import { NativeSelect } from "@/components/native-select";
import type { RegisterTypeData } from "@/components/register/types";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { formatBRL, formatBRLInput, parseBRL } from "@/domain/money";
import { subscriptionTotals } from "@/domain/subscriptions";
import {
  DESCRIPTION_MAX,
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/domain/transactions";
import { FILTER_PARAMS } from "@/lib/validation/transaction-filters";
import { cn } from "@/lib/utils";
import type { SubscriptionRow } from "@/server/recurring";

type Option = { id: string; name: string; archived: boolean };
export type SubscriptionOptions = {
  accounts: Option[];
  cards: Option[];
  categories: RegisterTypeData["tree"];
};

/** The counterparty, else the note, else the category. */
function nameOf(rule: SubscriptionRow) {
  return rule.counterparty?.name ?? rule.description ?? rule.category?.name ?? "Assinatura";
}

/** "Cartão Roxo" or "Banco Azul · Pix", with "(arquivado/a)" when it was archived since. */
function placeOf(rule: SubscriptionRow) {
  if (rule.card) return `${rule.card.name}${rule.card.archived ? " (arquivado)" : ""}`;
  const account = rule.account
    ? `${rule.account.name}${rule.account.archived ? " (arquivada)" : ""}`
    : "";
  return `${account} · ${PAYMENT_METHOD_LABELS[rule.method]}`;
}

/** The subscriptions screen (task 19): totals, the active, paused and canceled ones. */
export function SubscriptionList({
  subscriptions,
  options,
}: {
  subscriptions: SubscriptionRow[];
  options: SubscriptionOptions;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCanceled, setShowCanceled] = useState(false);
  const totals = subscriptionTotals(subscriptions);
  const active = subscriptions.filter((s) => s.status === "ACTIVE");
  const paused = subscriptions.filter((s) => s.status === "PAUSED");
  const canceled = subscriptions.filter((s) => s.status === "CANCELED");
  const open = subscriptions.find((s) => s.id === openId) ?? null;

  return (
    <div className="mt-4 grid gap-6">
      <section aria-label="Totais" className="grid grid-cols-2 gap-3 rounded-xl border p-4">
        <div className="grid gap-0.5">
          <p className="text-sm text-muted-foreground">Por mês</p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {formatBRL(totals.monthlyCents)}
          </p>
        </div>
        <div className="grid gap-0.5">
          <p className="text-sm text-muted-foreground">Por ano</p>
          <p className="text-2xl font-semibold tracking-tight tabular-nums">
            {formatBRL(totals.yearlyCents)}
          </p>
        </div>
        <p className="col-span-2 text-sm text-muted-foreground">
          {totals.count === 1 ? "1 assinatura ativa" : `${totals.count} assinaturas ativas`}
        </p>
      </section>

      <Section title="Ativas" empty="Nenhuma assinatura ativa." rules={active} onOpen={setOpenId} />
      {paused.length > 0 && <Section title="Pausadas" rules={paused} onOpen={setOpenId} />}
      {canceled.length > 0 && (
        <>
          <Button
            variant="ghost"
            className="h-10 justify-self-start"
            aria-expanded={showCanceled}
            onClick={() => setShowCanceled((shown) => !shown)}
          >
            {showCanceled ? "Ocultar canceladas" : `Mostrar canceladas (${canceled.length})`}
          </Button>
          {showCanceled && <Section title="Canceladas" rules={canceled} onOpen={setOpenId} />}
        </>
      )}

      <SubscriptionDialog rule={open} options={options} onClose={() => setOpenId(null)} />
    </div>
  );
}

function Section({
  title,
  empty,
  rules,
  onOpen,
}: {
  title: string;
  empty?: string;
  rules: SubscriptionRow[];
  onOpen: (id: string) => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {rules.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul aria-labelledby={id} className="mt-2 divide-y rounded-lg border">
          {rules.map((rule) => (
            <li key={rule.id}>
              <button
                type="button"
                onClick={() => onOpen(rule.id)}
                className={cn(
                  "flex min-h-16 w-full items-center gap-3 px-3 py-2 text-left hover:bg-muted/50",
                  rule.status === "CANCELED" && "opacity-60",
                )}
              >
                {rule.category ? (
                  <CategoryIcon
                    icon={rule.category.icon}
                    color={rule.category.color}
                    className="size-8"
                  />
                ) : (
                  <span aria-hidden className="size-8 shrink-0 rounded-lg bg-muted" />
                )}
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate font-medium">{nameOf(rule)}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    Todo dia {rule.dayOfMonth} · {placeOf(rule)}
                    {rule.category && ` · ${rule.category.name}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <StatusLine rule={rule} />
                  </span>
                  {rule.change && <ChangeBadge rule={rule} className="justify-self-start" />}
                </span>
                <span className="grid shrink-0 justify-items-end">
                  <span className="tabular-nums">{formatBRL(rule.amountCents)}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatBRL(rule.amountCents * 12)}/ano
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusLine({ rule }: { rule: SubscriptionRow }) {
  if (rule.status === "ACTIVE" && rule.nextCharge) {
    return <>Próxima cobrança em {formatCalendarDate(rule.nextCharge)}</>;
  }
  if (rule.status === "PAUSED") {
    return <>{rule.pausedOn ? `Pausada desde ${formatCalendarDate(rule.pausedOn)}` : "Pausada"}</>;
  }
  return (
    <>{rule.canceledOn ? `Cancelada em ${formatCalendarDate(rule.canceledOn)}` : "Cancelada"}</>
  );
}

/** "Era R$ 34,90 · subiu em 05/11/2026". */
function ChangeBadge({ rule, className }: { rule: SubscriptionRow; className?: string }) {
  const change = rule.change!;
  return (
    <span
      className={cn(
        "mt-0.5 inline-flex rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        change.direction === "up"
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          : "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
        className,
      )}
    >
      Era {formatBRL(change.previousCents)} · {change.direction === "up" ? "subiu" : "baixou"} em{" "}
      {formatCalendarDate(change.changedOn)}
    </span>
  );
}

type Mode = "details" | "edit" | "pause" | "cancel";

function SubscriptionDialog({
  rule,
  options,
  onClose,
}: {
  rule: SubscriptionRow | null;
  options: SubscriptionOptions;
  onClose: () => void;
}) {
  // Keeps the last content on screen while the sheet animates out.
  const [shown, setShown] = useState(rule);
  if (rule && rule !== shown) setShown(rule);
  return (
    <Dialog open={rule !== null} onOpenChange={(open) => !open && onClose()}>
      <ResponsiveDialogContent>
        {shown && <DialogBody key={shown.id} rule={shown} options={options} onDone={onClose} />}
      </ResponsiveDialogContent>
    </Dialog>
  );
}

function DialogBody({
  rule,
  options,
  onDone,
}: {
  rule: SubscriptionRow;
  options: SubscriptionOptions;
  onDone: () => void;
}) {
  const [mode, setMode] = useState<Mode>("details");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const name = nameOf(rule);

  function setStatus(status: "ACTIVE" | "PAUSED" | "CANCELED", message: string) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await setRecurringRuleStatusAction(rule.id, status);
        if (!result.ok) return setError(result.error);
      } catch {
        return setError("Não foi possível salvar. Verifique a conexão e tente de novo.");
      }
      toast(message);
      onDone();
    });
  }

  if (mode === "edit") {
    return (
      <EditForm rule={rule} options={options} onCancel={() => setMode("details")} onDone={onDone} />
    );
  }

  const confirming = mode === "pause" || mode === "cancel";
  const history =
    rule.counterparty &&
    `/lancamentos?${new URLSearchParams({
      [FILTER_PARAMS.counterpartyId]: rule.counterparty.id,
      [FILTER_PARAMS.from]: `${rule.firstMonth}-01`,
      [FILTER_PARAMS.to]: todayInSaoPaulo(),
    })}`;

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{name}</DialogTitle>
        <DialogDescription>
          {formatBRL(rule.amountCents)} por mês · {formatBRL(rule.amountCents * 12)} por ano
        </DialogDescription>
      </DialogHeader>

      <dl className="grid gap-2 text-sm">
        <Detail term="Cobrança">
          Todo dia {rule.dayOfMonth} · {placeOf(rule)}
        </Detail>
        <Detail term="Categoria">{rule.category?.name ?? "Sem categoria"}</Detail>
        {rule.description && <Detail term="Observação">{rule.description}</Detail>}
        <Detail term="Situação">
          <StatusLine rule={rule} />
        </Detail>
      </dl>
      {rule.change && <ChangeBadge rule={rule} className="justify-self-start" />}

      {mode === "pause" && (
        <p className="text-sm">Pausar {name}? Os meses pausados não são cobrados.</p>
      )}
      {mode === "cancel" && <p className="text-sm">Cancelar {name}? Não dá para desfazer.</p>}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <ResponsiveDialogFooter className="flex-wrap gap-2">
        {confirming ? (
          <>
            <Button variant="ghost" className="h-10" onClick={() => setMode("details")}>
              Voltar
            </Button>
            <Button
              variant={mode === "cancel" ? "destructive" : "default"}
              className="h-10"
              disabled={pending}
              onClick={() =>
                mode === "cancel"
                  ? setStatus("CANCELED", "Assinatura cancelada")
                  : setStatus("PAUSED", "Assinatura pausada")
              }
            >
              {mode === "cancel" ? "Cancelar assinatura" : "Pausar"}
            </Button>
          </>
        ) : rule.status === "CANCELED" ? (
          history && (
            <Button asChild variant="outline" className="h-10">
              <Link href={history}>Ver cobranças</Link>
            </Button>
          )
        ) : (
          <>
            {history && (
              <Button asChild variant="ghost" className="h-10">
                <Link href={history}>Ver cobranças</Link>
              </Button>
            )}
            <Button
              variant="ghost"
              className="h-10 text-destructive"
              onClick={() => setMode("cancel")}
            >
              Cancelar assinatura
            </Button>
            {rule.status === "PAUSED" ? (
              <Button
                variant="outline"
                className="h-10"
                disabled={pending}
                onClick={() => setStatus("ACTIVE", "Assinatura retomada")}
              >
                Retomar
              </Button>
            ) : (
              <Button variant="outline" className="h-10" onClick={() => setMode("pause")}>
                Pausar
              </Button>
            )}
            <Button className="h-10" onClick={() => setMode("edit")}>
              Editar
            </Button>
          </>
        )}
      </ResponsiveDialogFooter>
    </div>
  );
}

function Detail({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-muted-foreground">{term}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function EditForm({
  rule,
  options,
  onCancel,
  onDone,
}: {
  rule: SubscriptionRow;
  options: SubscriptionOptions;
  onCancel: () => void;
  onDone: () => void;
}) {
  const ids = {
    amount: useId(),
    day: useId(),
    category: useId(),
    method: useId(),
    place: useId(),
    description: useId(),
  };
  const [amount, setAmount] = useState(formatBRLInput(rule.amountCents));
  const [day, setDay] = useState(String(rule.dayOfMonth));
  const [categoryId, setCategoryId] = useState(rule.category?.id ?? "");
  const [method, setMethod] = useState<PaymentMethod>(rule.method);
  const [accountId, setAccountId] = useState(rule.account?.id ?? "");
  const [cardId, setCardId] = useState(rule.card?.id ?? "");
  const [description, setDescription] = useState(rule.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const credit = method === "CREDIT";
  // What the rule already points to stays offered, even archived.
  const accounts = options.accounts.filter((a) => !a.archived || a.id === rule.account?.id);
  const cards = options.cards.filter((c) => !c.archived || c.id === rule.card?.id);
  const inTree = options.categories.some(
    (p) => p.id === rule.category?.id || p.children.some((c) => c.id === rule.category?.id),
  );

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseBRL(amount);
    if (cents === null || cents <= 0) {
      setError("Informe o valor. Use o formato 1.234,56.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await editRecurringRuleAction(rule.id, {
          amountCents: cents,
          dayOfMonth: Number(day),
          method,
          accountId: credit ? null : accountId || accounts[0]?.id,
          cardId: credit ? cardId || cards[0]?.id : null,
          categoryId,
          description,
        });
        if (!result.ok) return setError(result.error);
      } catch {
        return setError("Não foi possível salvar. Verifique a conexão e tente de novo.");
      }
      toast("Assinatura atualizada");
      onDone();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Editar {nameOf(rule)}</DialogTitle>
        <DialogDescription>
          Vale para as próximas cobranças. As já lançadas não mudam.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.amount}>Valor por mês</Label>
        <MoneyInput id={ids.amount} value={amount} onValueChange={setAmount} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.day}>Dia da cobrança</Label>
        <NativeSelect id={ids.day} value={day} onChange={(e) => setDay(e.target.value)}>
          {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
            <option key={d} value={d}>
              Todo dia {d}
            </option>
          ))}
        </NativeSelect>
        {Number(day) > 28 && (
          <p className="text-xs text-muted-foreground">
            Nos meses mais curtos, no último dia do mês.
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.category}>Categoria</Label>
        <NativeSelect
          id={ids.category}
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
        >
          <option value="">Sem categoria</option>
          {options.categories.map((parent) => (
            <optgroup key={parent.id} label={parent.name}>
              <option value={parent.id}>{parent.name}</option>
              {parent.children.map((child) => (
                <option key={child.id} value={child.id}>
                  {child.name}
                </option>
              ))}
            </optgroup>
          ))}
          {rule.category && !inTree && (
            <option value={rule.category.id}>{rule.category.name} (arquivada)</option>
          )}
        </NativeSelect>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.method}>Forma</Label>
        <NativeSelect
          id={ids.method}
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {PAYMENT_METHODS.filter((m) => m !== "CREDIT" || cards.length > 0).map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABELS[m]}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.place}>{credit ? "Cartão" : "Conta"}</Label>
        <NativeSelect
          id={ids.place}
          value={credit ? cardId || cards[0]?.id || "" : accountId || accounts[0]?.id || ""}
          onChange={(e) => (credit ? setCardId : setAccountId)(e.target.value)}
        >
          {(credit ? cards : accounts).map((o) => (
            <option key={o.id} value={o.id}>
              {o.archived ? `${o.name} (${credit ? "arquivado" : "arquivada"})` : o.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.description}>Observação</Label>
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

      <ResponsiveDialogFooter className="gap-2">
        <Button type="button" variant="ghost" className="h-10" onClick={onCancel}>
          Voltar
        </Button>
        <Button type="submit" disabled={pending} className="h-10">
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
