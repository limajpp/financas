"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createOngoingAction,
  createSubscriptionRuleAction,
  finishOnboardingAction,
  setOpeningBalanceAction,
} from "@/app/(app)/comecar/actions";
import { AccountDialog, type AccountDialogState } from "@/components/accounts/account-dialog";
import { CardDialog, type CardDialogState } from "@/components/cards/card-dialog";
import { MoneyInput } from "@/components/money-input";
import { NativeSelect } from "@/components/native-select";
import { COLOR_CLASSES } from "@/components/palette";
import { ResponsiveDialogContent, ResponsiveDialogFooter } from "@/components/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCalendarDate } from "@/domain/dates";
import { formatBRL, formatBRLInput, parseBRL } from "@/domain/money";
import type { PaletteColor } from "@/domain/palette";
import {
  COUNTERPARTY_NAME_MAX,
  METHODS_BY_TYPE,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
} from "@/domain/transactions";
import { cn } from "@/lib/utils";
import type { OnboardingData } from "@/server/onboarding";

import { ONBOARDING_STEPS } from "./steps";

const NETWORK_ERROR = "Não foi possível salvar. Verifique a conexão e tente de novo.";

/** The onboarding screen (task 22): one step at a time, each saved as you go. */
export function OnboardingWizard({
  step,
  total,
  data,
}: {
  step: number;
  total: number;
  data: OnboardingData;
}) {
  const router = useRouter();
  const [finishing, startFinishing] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { title, question } = ONBOARDING_STEPS[step - 1]!;
  const hasSomething = [
    data.accounts.length,
    data.cards.length,
    data.purchases.length,
    data.subscriptions.length,
  ][step - 1]!;
  const last = step === total;

  function finish() {
    setError(null);
    startFinishing(async () => {
      try {
        await finishOnboardingAction();
      } catch {
        return setError(NETWORK_ERROR);
      }
      router.push("/");
    });
  }

  return (
    <div className="grid gap-6">
      <header className="grid gap-1">
        <p className="text-sm text-muted-foreground">
          Passo {step} de {total}
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{question}</p>
        <div className="mt-2 flex gap-1" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={cn("h-1 flex-1 rounded-full", i < step ? "bg-primary" : "bg-muted")}
            />
          ))}
        </div>
      </header>

      {step === 1 && <AccountsStep data={data} />}
      {step === 2 && <CardsStep data={data} />}
      {step === 3 && <PurchasesStep data={data} />}
      {step === 4 && <SubscriptionsStep data={data} />}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <nav aria-label="Passos" className="grid gap-3 border-t pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {step > 1 ? (
            <Button asChild variant="ghost" className="h-10">
              <Link href={`/comecar?passo=${step - 1}`}>Voltar</Link>
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            {step > 1 && !last && (
              <Button variant="outline" className="h-10" disabled={finishing} onClick={finish}>
                Concluir
              </Button>
            )}
            {last ? (
              <Button className="h-10" disabled={finishing} onClick={finish}>
                {finishing ? "Concluindo…" : "Concluir"}
              </Button>
            ) : (
              <Button asChild variant={hasSomething ? "default" : "outline"} className="h-10">
                <Link href={`/comecar?passo=${step + 1}`}>
                  {hasSomething ? "Próximo" : "Pular este passo"}
                </Link>
              </Button>
            )}
          </div>
        </div>
        <Button asChild variant="link" className="justify-self-center text-muted-foreground">
          <Link href="/">Pular por agora</Link>
        </Button>
      </nav>
    </div>
  );
}

function AddButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <Button variant="outline" className="h-10 gap-2 justify-self-start" onClick={onClick}>
      <Plus aria-hidden />
      {children}
    </Button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

function AccountsStep({ data }: { data: OnboardingData }) {
  const [dialog, setDialog] = useState<AccountDialogState | null>(null);
  return (
    <section aria-label="Contas" className="grid gap-4">
      {data.accounts.length === 0 ? (
        <Empty>Nenhuma conta ainda.</Empty>
      ) : (
        <ul aria-label="Contas cadastradas" className="divide-y rounded-lg border">
          {data.accounts.map((account) => (
            <li key={account.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <span
                aria-hidden
                className={cn(
                  "size-3 shrink-0 rounded-full",
                  (COLOR_CLASSES[account.color as PaletteColor] ?? COLOR_CLASSES.slate).swatch,
                )}
              />
              <span className="min-w-0 flex-1 truncate font-medium">{account.name}</span>
              <span
                className={cn(
                  "shrink-0 tabular-nums",
                  account.balanceCents < 0 && "text-destructive",
                )}
              >
                {formatBRL(account.balanceCents)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <AddButton onClick={() => setDialog({ mode: "create" })}>Adicionar conta</AddButton>
      <AccountDialog state={dialog} onClose={() => setDialog(null)} />
    </section>
  );
}

function CardsStep({ data }: { data: OnboardingData }) {
  const [dialog, setDialog] = useState<CardDialogState | null>(null);
  const payers = data.accounts.map((a) => ({ id: a.id, name: a.name, archived: false }));
  return (
    <section aria-label="Cartões" className="grid gap-4">
      {data.cards.length === 0 ? (
        <Empty>Nenhum cartão ainda. Se não usa cartão de crédito, pule este passo.</Empty>
      ) : (
        <ul aria-label="Cartões cadastrados" className="grid gap-3">
          {data.cards.map((card) => (
            <li key={card.id} className="grid gap-3 rounded-lg border p-3">
              <p className="font-medium">
                {card.name}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  · paga com {card.accountName}
                </span>
              </p>
              <InvoiceAmount
                cardId={card.id}
                cardName={card.name}
                invoice={card.open}
                label={`Quanto já tem na fatura aberta (vence em ${formatCalendarDate(card.open.dueDate).slice(0, 5)})?`}
              />
              {card.closed && (
                <InvoiceAmount
                  cardId={card.id}
                  cardName={card.name}
                  invoice={card.closed}
                  label={`E a fatura fechada que vence em ${formatCalendarDate(card.closed.dueDate).slice(0, 5)}, ainda sem pagar?`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        Use o valor que o app do banco mostra hoje, já com as parcelas. Ele entra como “saldo
        anterior da fatura”: conta no total e no pagamento, mas não como gasto do mês.
      </p>
      <AddButton onClick={() => setDialog({ mode: "create" })}>Adicionar cartão</AddButton>
      <CardDialog state={dialog} accounts={payers} onClose={() => setDialog(null)} />
    </section>
  );
}

/** One invoice's amount as the bank shows it today; saving again replaces it, zero clears it. */
function InvoiceAmount({
  cardId,
  cardName,
  invoice,
  label,
}: {
  cardId: string;
  cardName: string;
  invoice: OnboardingData["cards"][number]["open"];
  label: string;
}) {
  const id = useId();
  const [value, setValue] = useState(
    invoice.informedCents === null ? "" : formatBRLInput(invoice.informedCents),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = value.trim() === "" ? 0 : parseBRL(value);
    if (cents === null || cents < 0) {
      setError("Valor inválido. Use o formato 1.234,56.");
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await setOpeningBalanceAction({
          cardId,
          dueDate: invoice.dueDate,
          amountCents: cents,
        });
        if (!result.ok) return setError(result.error);
      } catch {
        return setError(NETWORK_ERROR);
      }
      toast(
        cents === 0
          ? `Fatura de ${formatCalendarDate(invoice.dueDate).slice(0, 5)} do ${cardName} sem saldo anterior`
          : `Fatura de ${formatCalendarDate(invoice.dueDate).slice(0, 5)} do ${cardName}: ${formatBRL(cents)}`,
      );
    });
  }

  return (
    <form onSubmit={save} className="grid gap-1.5" noValidate>
      <Label htmlFor={id} className="leading-snug font-normal">
        {label}
        <span className="sr-only"> {cardName}, em reais</span>
      </Label>
      <div className="flex gap-2">
        <MoneyInput
          id={id}
          value={value}
          onValueChange={setValue}
          placeholder="0,00"
          className="flex-1"
          {...(error ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {})}
        />
        <Button type="submit" variant="secondary" className="h-10" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function CategorySelect({
  id,
  value,
  onChange,
  categories,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  categories: OnboardingData["categories"];
}) {
  return (
    <NativeSelect id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Sem categoria</option>
      {categories.map((parent) => (
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
  );
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  );
}

function PurchasesStep({ data }: { data: OnboardingData }) {
  const [open, setOpen] = useState(false);
  // A new form (and a new id) every time the dialog opens.
  const [formKey, setFormKey] = useState(0);
  return (
    <section aria-label="Parcelamentos" className="grid gap-4">
      {data.purchases.length === 0 ? (
        <Empty>Nenhum parcelamento cadastrado.</Empty>
      ) : (
        <ul aria-label="Parcelamentos cadastrados" className="divide-y rounded-lg border">
          {data.purchases.map((p) => (
            <li key={p.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">{p.name}</span>
                <span className="truncate text-sm text-muted-foreground">
                  {p.cardName} · {p.current} de {p.total}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatBRL(p.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {data.cards.length === 0 ? (
        <Empty>
          Os parcelamentos ficam num cartão.{" "}
          <Link href="/comecar?passo=2" className="text-foreground underline underline-offset-4">
            Cadastre um cartão
          </Link>{" "}
          primeiro.
        </Empty>
      ) : (
        <AddButton
          onClick={() => {
            setFormKey((k) => k + 1);
            setOpen(true);
          }}
        >
          Adicionar parcelamento
        </AddButton>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <PurchaseForm key={formKey} data={data} onDone={() => setOpen(false)} />
        </ResponsiveDialogContent>
      </Dialog>
    </section>
  );
}

function PurchaseForm({ data, onDone }: { data: OnboardingData; onDone: () => void }) {
  const ids = {
    card: useId(),
    name: useId(),
    category: useId(),
    current: useId(),
    total: useId(),
    amount: useId(),
  };
  const clientId = useRef<string | null>(null);
  const [cardId, setCardId] = useState(data.cards[0]?.id ?? "");
  const [name, setName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [current, setCurrent] = useState("");
  const [total, setTotal] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cents = parseBRL(amount);
    if (cents === null || cents <= 0) {
      setError("Informe o valor de cada parcela. Use o formato 1.234,56.");
      return;
    }
    setError(null);
    // One id per purchase: a double tap or a retry doesn't create it twice.
    const id = (clientId.current ??= crypto.randomUUID());
    startTransition(async () => {
      try {
        const result = await createOngoingAction({
          clientId: id,
          cardId,
          counterparty: name,
          categoryId,
          current: Number(current),
          total: Number(total),
          amountCents: cents,
        });
        if (!result.ok) return setError(result.error);
        toast(result.notice ?? "Parcelamento cadastrado");
      } catch {
        return setError(NETWORK_ERROR);
      }
      onDone();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Parcelamento em andamento</DialogTitle>
        <DialogDescription>
          O app cria as parcelas que faltam, da atual até a última, uma por fatura.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.card}>Cartão</Label>
        <NativeSelect id={ids.card} value={cardId} onChange={(e) => setCardId(e.target.value)}>
          {data.cards.map((card) => (
            <option key={card.id} value={card.id}>
              {card.name}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.name}>
          O que foi <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <Input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={COUNTERPARTY_NAME_MAX}
          autoComplete="off"
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.category}>
          Categoria <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <CategorySelect
          id={ids.category}
          value={categoryId}
          onChange={setCategoryId}
          categories={data.categories}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.current}>Parcela atual</Label>
          <Input
            id={ids.current}
            value={current}
            onChange={(e) => setCurrent(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="3"
            autoComplete="off"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.total}>De quantas</Label>
          <Input
            id={ids.total}
            value={total}
            onChange={(e) => setTotal(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            placeholder="10"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.amount}>
          Valor de cada parcela<span className="sr-only"> em reais</span>
        </Label>
        <MoneyInput id={ids.amount} value={amount} onValueChange={setAmount} placeholder="0,00" />
      </div>

      <p className="text-sm text-muted-foreground">
        A parcela atual já está na fatura aberta: se você informou o valor dela no passo anterior,
        ela sai do saldo anterior, para não contar duas vezes.
      </p>

      <FormError error={error} />

      <ResponsiveDialogFooter>
        <Button type="submit" disabled={pending} className="h-10 w-full sm:w-auto">
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}

function SubscriptionsStep({ data }: { data: OnboardingData }) {
  const [open, setOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);
  return (
    <section aria-label="Assinaturas" className="grid gap-4">
      {data.subscriptions.length === 0 ? (
        <Empty>Nenhuma assinatura cadastrada.</Empty>
      ) : (
        <ul aria-label="Assinaturas cadastradas" className="divide-y rounded-lg border">
          {data.subscriptions.map((s) => (
            <li key={s.id} className="flex min-h-12 items-center gap-3 px-3 py-2">
              <span className="grid min-w-0 flex-1">
                <span className="truncate font-medium">{s.name}</span>
                <span className="truncate text-sm text-muted-foreground">
                  Todo dia {s.dayOfMonth} · {s.place}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{formatBRL(s.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {data.accounts.length === 0 ? (
        <Empty>
          A assinatura é paga por uma conta ou um cartão.{" "}
          <Link href="/comecar?passo=1" className="text-foreground underline underline-offset-4">
            Cadastre uma conta
          </Link>{" "}
          primeiro.
        </Empty>
      ) : (
        <AddButton
          onClick={() => {
            setFormKey((k) => k + 1);
            setOpen(true);
          }}
        >
          Adicionar assinatura
        </AddButton>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent>
          <SubscriptionForm key={formKey} data={data} onDone={() => setOpen(false)} />
        </ResponsiveDialogContent>
      </Dialog>
    </section>
  );
}

function SubscriptionForm({ data, onDone }: { data: OnboardingData; onDone: () => void }) {
  const ids = {
    name: useId(),
    amount: useId(),
    day: useId(),
    method: useId(),
    place: useId(),
    category: useId(),
  };
  const methods = METHODS_BY_TYPE.EXPENSE.filter((m) => m !== "CREDIT" || data.cards.length > 0);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [day, setDay] = useState("");
  const [method, setMethod] = useState<PaymentMethod>(data.cards.length > 0 ? "CREDIT" : "PIX");
  const [accountId, setAccountId] = useState(data.accounts[0]?.id ?? "");
  const [cardId, setCardId] = useState(data.cards[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const credit = method === "CREDIT";

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
        const result = await createSubscriptionRuleAction({
          counterparty: name,
          rule: {
            amountCents: cents,
            dayOfMonth: Number(day),
            method,
            accountId: credit ? null : accountId,
            cardId: credit ? cardId : null,
            categoryId,
            description: null,
          },
        });
        if (!result.ok) return setError(result.error);
      } catch {
        return setError(NETWORK_ERROR);
      }
      toast("Assinatura cadastrada");
      onDone();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Assinatura ativa</DialogTitle>
        <DialogDescription>
          Sem cobrança agora: a deste mês, se já passou, já está no saldo. O app cobra a partir da
          próxima data.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.name}>O que é</Label>
        <Input
          id={ids.name}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={COUNTERPARTY_NAME_MAX}
          autoComplete="off"
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.amount}>
            Valor por mês<span className="sr-only"> em reais</span>
          </Label>
          <MoneyInput id={ids.amount} value={amount} onValueChange={setAmount} placeholder="0,00" />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={ids.day}>Dia da cobrança</Label>
          <NativeSelect id={ids.day} value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="" disabled>
              Escolha
            </option>
            {Array.from({ length: 31 }, (_, i) => String(i + 1)).map((d) => (
              <option key={d} value={d}>
                Todo dia {d}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={ids.method}>Forma</Label>
          <NativeSelect
            id={ids.method}
            value={method}
            onChange={(e) => setMethod(e.target.value as PaymentMethod)}
          >
            {methods.map((m) => (
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
            value={credit ? cardId : accountId}
            onChange={(e) => (credit ? setCardId : setAccountId)(e.target.value)}
          >
            {(credit ? data.cards : data.accounts).map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor={ids.category}>
          Categoria <span className="font-normal text-muted-foreground">(opcional)</span>
        </Label>
        <CategorySelect
          id={ids.category}
          value={categoryId}
          onChange={setCategoryId}
          categories={data.categories}
        />
      </div>

      <FormError error={error} />

      <ResponsiveDialogFooter>
        <Button type="submit" disabled={pending} className="h-10 w-full sm:w-auto">
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </ResponsiveDialogFooter>
    </form>
  );
}
