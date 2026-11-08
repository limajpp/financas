import "server-only";

import { type BalanceEntry, accountBalance } from "@/domain/balance";
import { calendarDateToDb, dbToCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { addAlias, resolveCounterparty } from "@/domain/counterparty-memory";
import { normalizeName } from "@/domain/names";
import type { CycleVersion } from "@/domain/invoice-cycle";
import { planInstallments } from "@/domain/installments";
import { addMonthsToMonth, monthOf } from "@/domain/recurring";
import { defaultInvoiceToPay, invoiceSummaries } from "@/domain/invoices";
import {
  type CardPaymentInput,
  type CurrentRefs,
  type EntryInput,
  type EntryRefs,
  type InstallmentScope,
  type TransactionError,
  type TransferInput,
  validateCardPayment,
  validateEntry,
  validateTransfer,
} from "@/domain/transactions";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { updateRecurringRule } from "@/server/recurring";

const transactionSelect = {
  id: true,
  clientId: true,
  type: true,
  amountCents: true,
  date: true,
  method: true,
  accountId: true,
  toAccountId: true,
  cardId: true,
  invoiceDueDate: true,
  invoiceOverridden: true,
  categoryId: true,
  description: true,
  installmentGroupId: true,
  installmentNumber: true,
  installmentTotal: true,
  recurringRuleId: true,
  recurringMonth: true,
  counterparty: { select: { id: true, name: true } },
} as const;

type TransactionDbRow = Prisma.TransactionGetPayload<{ select: typeof transactionSelect }>;

function toTransaction(row: TransactionDbRow) {
  return {
    ...row,
    date: dbToCalendarDate(row.date),
    invoiceDueDate: row.invoiceDueDate && dbToCalendarDate(row.invoiceDueDate),
  };
}

export type TransactionRow = ReturnType<typeof toTransaction>;

export type TransactionResult =
  | { ok: true; transaction: TransactionRow }
  | { ok: false; error: TransactionError | "NOT_FOUND" | "NOT_EDITABLE" };

export type CreateTransactionResult =
  | { ok: true; transaction: TransactionRow; created: boolean }
  | { ok: false; error: TransactionError };

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** The account, card and category the entry names, looked up in the space only. */
async function refsFor(spaceId: string, input: EntryInput): Promise<EntryRefs> {
  const [accounts, cards, categories] = await Promise.all([
    input.accountId
      ? db.account.findMany({
          where: { id: input.accountId, spaceId },
          select: { id: true, archivedAt: true },
        })
      : [],
    input.cardId
      ? db.card.findMany({
          where: { id: input.cardId, spaceId },
          select: {
            id: true,
            archivedAt: true,
            cycles: { select: { closingDay: true, dueDay: true, validFrom: true } },
          },
        })
      : [],
    input.categoryId
      ? db.category.findMany({
          where: { id: input.categoryId, spaceId },
          select: {
            id: true,
            type: true,
            archivedAt: true,
            parent: { select: { archivedAt: true } },
          },
        })
      : [],
  ]);
  return {
    accounts,
    cards: cards.map((card) => ({
      ...card,
      cycles: card.cycles.map((c) => ({ ...c, validFrom: dbToCalendarDate(c.validFrom) })),
    })),
    categories,
  };
}

/**
 * The counterparty an entry names, in the space: by name (without case and accents), else the
 * only one with exactly that alias or CPF/CNPJ; created if none. By name, not id: an entry made
 * offline may name one the server doesn't know yet. The alias and CPF/CNPJ typed with the entry
 * are then added to it.
 */
async function counterpartyIdFor(
  spaceId: string,
  input: Pick<EntryInput, "counterparty" | "counterpartyAlias" | "counterpartyDocument">,
) {
  const name = input.counterparty;
  if (name === null) return null;
  const nameKey = normalizeName(name);
  const where = { spaceId_nameKey: { spaceId, nameKey } };
  const select = { id: true, aliases: true, document: true } as const;

  let found = await db.counterparty.findUnique({ where, select });
  if (!found) {
    // Only counterparties in use: an orphan (an undone entry) must not make an alias ambiguous.
    const all = await db.counterparty.findMany({
      where: { spaceId, transactions: { some: {} } },
      select: { ...select, name: true },
    });
    const id = resolveCounterparty(name, all);
    found = all.find((c) => c.id === id) ?? null;
  }
  if (!found) {
    try {
      found = await db.counterparty.create({ data: { spaceId, name, nameKey }, select });
    } catch (error) {
      // Created at the same time by another request.
      if (!isUniqueViolation(error)) throw error;
      found = await db.counterparty.findUniqueOrThrow({ where, select });
    }
  }

  // Read-modify-write without a lock: two saves at the same instant may keep only one new alias.
  // Accepted (one person per space). An alias equal to the name adds nothing.
  const aliases =
    input.counterpartyAlias && normalizeName(input.counterpartyAlias) !== normalizeName(name)
      ? addAlias(found.aliases, input.counterpartyAlias)
      : found.aliases;
  const document = input.counterpartyDocument ?? found.document;
  // Compared by content: at the limit, adding one drops the oldest (same length).
  const aliasesChanged = aliases.join("\n") !== found.aliases.join("\n");
  if (aliasesChanged || document !== found.document) {
    await db.counterparty.update({ where: { id: found.id }, data: { aliases, document } });
  }
  return found.id;
}

function entryData(
  input: EntryInput,
  invoice: { invoiceDueDate: string; invoiceOverridden: boolean } | null,
) {
  return {
    type: input.type,
    amountCents: input.amountCents,
    date: calendarDateToDb(input.date),
    method: input.method,
    accountId: input.accountId,
    cardId: input.cardId,
    toAccountId: null,
    invoiceDueDate: invoice ? calendarDateToDb(invoice.invoiceDueDate) : null,
    invoiceOverridden: invoice?.invoiceOverridden ?? false,
    categoryId: input.categoryId,
    description: input.description,
  };
}

async function findByClientId(spaceId: string, clientId: string) {
  const row = await db.transaction.findUnique({
    where: { spaceId_clientId: { spaceId, clientId } },
    select: transactionSelect,
  });
  return row && toTransaction(row);
}

/**
 * Creates an expense or income. Idempotent by `clientId`: if the space already has it, returns
 * that one unchanged (`created: false`), including when two calls race.
 *
 * Reads, validation and the insert aren't one database transaction: a card cycle edited in the
 * same instant could leave this purchase on the old cycle's invoice. Accepted (one user per space,
 * and the invoice can be fixed by editing).
 */
export async function createTransaction(
  spaceId: string,
  userId: string,
  clientId: string,
  input: EntryInput,
): Promise<CreateTransactionResult> {
  return createIdempotent(spaceId, clientId, async () => {
    const refs = await refsFor(spaceId, input);
    const checked = validateEntry(input, refs, { today: todayInSaoPaulo() });
    if (!checked.ok) return checked;
    const row = {
      createdById: userId,
      counterpartyId: await counterpartyIdFor(spaceId, input),
      ...entryData(input, checked.invoice),
    };
    if (input.subscription) {
      // A subscription: the rule and its 1st charge, in the month of the date (task 13).
      const month = monthOf(input.date);
      return {
        ok: true,
        data: {
          rule: {
            createdById: userId,
            amountCents: input.amountCents,
            dayOfMonth: Number(input.date.slice(8, 10)),
            method: input.method,
            accountId: input.accountId,
            cardId: input.cardId,
            categoryId: input.categoryId,
            counterpartyId: row.counterpartyId,
            description: input.description,
            firstMonth: month,
            nextMonth: addMonthsToMonth(month, 1),
          },
          charge: { ...row, recurringMonth: month },
        },
      };
    }
    if (input.installments === null) return { ok: true, data: row };

    // A purchase in installments: one row per installment, one invoice after another.
    const cycles = refs.cards.find((c) => c.id === input.cardId)!.cycles;
    const installmentGroupId = crypto.randomUUID();
    const plan = planInstallments(input, input.installments, cycles);
    return {
      ok: true,
      data: plan.map((installment) => ({
        ...row,
        amountCents: installment.amountCents,
        date: calendarDateToDb(installment.date),
        invoiceDueDate: calendarDateToDb(installment.invoiceDueDate),
        invoiceOverridden: false,
        installmentGroupId,
        installmentNumber: installment.number,
        installmentTotal: plan.length,
      })),
    };
  });
}

type NewRow = Omit<Prisma.TransactionUncheckedCreateInput, "spaceId" | "clientId">;
type NewSubscription = {
  rule: Omit<Prisma.RecurringRuleUncheckedCreateInput, "spaceId">;
  charge: Omit<NewRow, "recurringRuleId">;
};

/** The clientId of installment `number`: the device's id for the 1st, `id:N` for the others. */
const installmentClientId = (clientId: string, number: number) =>
  number === 1 ? clientId : `${clientId}:${number}`;

/**
 * Creates a transaction once per `clientId`: if the space already has it, returns that one
 * unchanged (`created: false`), including when two calls race (the unique index decides).
 * `prepare` validates and builds the row; it runs only when the entry is new.
 */
async function createIdempotent(
  spaceId: string,
  clientId: string,
  prepare: () => Promise<
    { ok: true; data: NewRow | NewRow[] | NewSubscription } | { ok: false; error: TransactionError }
  >,
): Promise<CreateTransactionResult> {
  const existing = await findByClientId(spaceId, clientId);
  if (existing) return { ok: true, transaction: existing, created: false };

  const prepared = await prepare();
  if (!prepared.ok) return prepared;

  try {
    if ("rule" in prepared.data) {
      // The rule and its 1st charge go together (and a clientId clash undoes both).
      const { rule, charge } = prepared.data;
      const row = await db.$transaction(async (tx) => {
        const created = await tx.recurringRule.create({
          data: { ...rule, spaceId },
          select: { id: true },
        });
        return tx.transaction.create({
          data: { ...charge, spaceId, clientId, recurringRuleId: created.id },
          select: transactionSelect,
        });
      });
      return { ok: true, transaction: toTransaction(row), created: true };
    }
    if (Array.isArray(prepared.data)) {
      // Installments: all in one statement (all or none); the 1st carries the device's id.
      await db.transaction.createMany({
        data: prepared.data.map((row, i) => ({
          ...row,
          spaceId,
          clientId: installmentClientId(clientId, i + 1),
        })),
      });
      const first = await findByClientId(spaceId, clientId);
      return { ok: true, transaction: first!, created: true };
    }
    const row = await db.transaction.create({
      data: { ...prepared.data, spaceId, clientId },
      select: transactionSelect,
    });
    return { ok: true, transaction: toTransaction(row), created: true };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const winner = await findByClientId(spaceId, clientId);
      if (winner) return { ok: true, transaction: winner, created: false };
      // A purchase in installments whose 1st was deleted ("só esta"): the next ones still hold
      // the derived ids, and a resend must not fail.
      if (Array.isArray(prepared.data)) {
        const sibling = await db.transaction.findFirst({
          where: {
            spaceId,
            clientId: {
              in: prepared.data.map((_, i) => installmentClientId(clientId, i + 1)),
            },
          },
          orderBy: { installmentNumber: "asc" },
          select: transactionSelect,
        });
        if (sibling) return { ok: true, transaction: toTransaction(sibling), created: false };
      }
    }
    throw error;
  }
}

/** Creates a transfer between two of the space's accounts (idempotent by `clientId`). */
export async function createTransfer(
  spaceId: string,
  userId: string,
  clientId: string,
  input: TransferInput,
): Promise<CreateTransactionResult> {
  return createIdempotent(spaceId, clientId, async () => {
    const accounts = await db.account.findMany({
      where: { spaceId, id: { in: [input.accountId, input.toAccountId] } },
      select: { id: true, archivedAt: true },
    });
    const checked = validateTransfer(input, accounts, todayInSaoPaulo());
    if (!checked.ok) return checked;
    return {
      ok: true,
      data: {
        createdById: userId,
        type: "TRANSFER",
        amountCents: input.amountCents,
        date: calendarDateToDb(input.date),
        method: input.method,
        accountId: input.accountId,
        toAccountId: input.toAccountId,
        description: input.description,
      },
    };
  });
}

/**
 * The credit purchases and invoice payments of the space's cards, summed per card and invoice
 * (one query for any number of cards).
 */
async function cardAmounts(spaceId: string, cardIds: readonly string[]) {
  const groups = await db.transaction.groupBy({
    by: ["cardId", "type", "invoiceDueDate"],
    where: {
      spaceId,
      cardId: { in: [...cardIds] },
      invoiceDueDate: { not: null },
      OR: [{ type: "EXPENSE", method: "CREDIT" }, { type: "CARD_PAYMENT" }],
    },
    _sum: { amountCents: true },
  });
  type Amount = { invoiceDueDate: string; amountCents: number };
  const byCard = new Map<string, { purchases: Amount[]; payments: Amount[] }>();
  for (const g of groups) {
    const amounts = byCard.get(g.cardId!) ?? { purchases: [], payments: [] };
    const amount = {
      invoiceDueDate: dbToCalendarDate(g.invoiceDueDate!),
      amountCents: g._sum.amountCents ?? 0,
    };
    (g.type === "CARD_PAYMENT" ? amounts.payments : amounts.purchases).push(amount);
    byCard.set(g.cardId!, amounts);
  }
  return (cardId: string) => byCard.get(cardId) ?? { purchases: [], payments: [] };
}

async function spaceCardWithCycles(spaceId: string, cardId: string) {
  const card = await db.card.findFirst({
    where: { id: cardId, spaceId },
    select: {
      id: true,
      accountId: true,
      cycles: { select: { closingDay: true, dueDay: true, validFrom: true } },
    },
  });
  return (
    card && {
      ...card,
      cycles: card.cycles.map((c) => ({ ...c, validFrom: dbToCalendarDate(c.validFrom) })),
    }
  );
}

/** Pays a card's invoice from an account (idempotent by `clientId`). */
export async function createCardPayment(
  spaceId: string,
  userId: string,
  clientId: string,
  input: CardPaymentInput,
): Promise<CreateTransactionResult> {
  return createIdempotent(spaceId, clientId, async () => {
    const [accounts, card] = await Promise.all([
      db.account.findMany({
        where: { spaceId, id: input.accountId },
        select: { id: true, archivedAt: true },
      }),
      spaceCardWithCycles(spaceId, input.cardId),
    ]);
    const purchaseDueDates = card
      ? (await cardAmounts(spaceId, [card.id]))(card.id).purchases.map((p) => p.invoiceDueDate)
      : [];
    const checked = validateCardPayment(
      input,
      { accounts, card, purchaseDueDates },
      todayInSaoPaulo(),
    );
    if (!checked.ok) return checked;
    return {
      ok: true,
      data: {
        createdById: userId,
        type: "CARD_PAYMENT",
        amountCents: input.amountCents,
        date: calendarDateToDb(input.date),
        method: input.method,
        accountId: input.accountId,
        cardId: input.cardId,
        invoiceDueDate: calendarDateToDb(input.invoiceDueDate),
        description: input.description,
      },
    };
  });
}

/**
 * What the "Pagar fatura" dialog needs for each of the given cards (already loaded from the
 * space, with their cycles): the invoices (total, paid, remaining), the one to start on, the
 * account that pays it and the last payment method used. Two queries for any number of cards.
 */
export async function cardsInvoices(
  spaceId: string,
  cards: readonly { id: string; accountId: string; cycles: CycleVersion[] }[],
) {
  const today = todayInSaoPaulo();
  const [amountsOf, lastPayment] = await Promise.all([
    cardAmounts(
      spaceId,
      cards.map((c) => c.id),
    ),
    db.transaction.findFirst({
      where: { spaceId, type: "CARD_PAYMENT" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { method: true },
    }),
  ]);
  return new Map(
    cards.map((card) => {
      const { purchases, payments } = amountsOf(card.id);
      const invoices = invoiceSummaries(purchases, payments, card.cycles, today);
      return [
        card.id,
        {
          invoices,
          defaultDueDate: defaultInvoiceToPay(invoices),
          accountId: card.accountId,
          method: lastPayment?.method ?? "PIX",
        },
      ] as const;
    }),
  );
}

/** cardsInvoices for one card of the space; null when the card isn't in the space. */
export async function cardInvoices(spaceId: string, cardId: string) {
  const card = await spaceCardWithCycles(spaceId, cardId);
  if (!card) return null;
  return (await cardsInvoices(spaceId, [card])).get(card.id)!;
}

/**
 * Edits an expense or income: everything but `clientId` and the author. A credit purchase's
 * invoice is recomputed unless the input brings a manual choice again.
 *
 * An installment (task 12) keeps its date, card, method and type; with scope "following" the
 * category, counterparty and description also change on the next installments, and the amount
 * only changes with scope "this".
 */
export async function updateTransaction(
  spaceId: string,
  id: string,
  input: EntryInput,
  scope: InstallmentScope = "this",
  { updateRule = false }: { updateRule?: boolean } = {},
): Promise<TransactionResult> {
  const current = await db.transaction.findFirst({
    where: { id, spaceId },
    select: {
      type: true,
      method: true,
      amountCents: true,
      accountId: true,
      cardId: true,
      categoryId: true,
      date: true,
      invoiceDueDate: true,
      invoiceOverridden: true,
      installmentGroupId: true,
      installmentNumber: true,
      recurringRuleId: true,
    },
  });
  if (!current) return { ok: false, error: "NOT_FOUND" };
  if (input.subscription && current.recurringRuleId === null) {
    return { ok: false, error: "SUBSCRIPTION_ON_EDIT" };
  }
  if (current.type !== "EXPENSE" && current.type !== "INCOME") {
    return { ok: false, error: "NOT_EDITABLE" };
  }

  const refs: CurrentRefs = {
    ...current,
    date: dbToCalendarDate(current.date),
    invoiceDueDate: current.invoiceDueDate && dbToCalendarDate(current.invoiceDueDate),
  };

  if (current.installmentGroupId !== null) {
    return updateInstallments(spaceId, id, input, scope, {
      ...current,
      date: dbToCalendarDate(current.date),
      invoiceDueDate: refs.invoiceDueDate ?? null,
    });
  }

  if (input.installments !== null) return { ok: false, error: "INSTALLMENTS_ON_EDIT" };
  const checked = validateEntry(input, await refsFor(spaceId, input), {
    today: todayInSaoPaulo(),
    current: refs,
  });
  if (!checked.ok) return checked;

  try {
    const row = await db.transaction.update({
      where: { id, spaceId },
      data: {
        counterpartyId: await counterpartyIdFor(spaceId, input),
        ...entryData(input, checked.invoice),
      },
      select: transactionSelect,
    });
    // "Atualizar a assinatura?" — yes: the next charges use the new amount, and it's recorded.
    if (updateRule && current.recurringRuleId !== null) {
      await updateRecurringRule(spaceId, current.recurringRuleId, {
        amountCents: input.amountCents,
      });
    }
    return { ok: true, transaction: toTransaction(row) };
  } catch (error) {
    // Deleted meanwhile (another tab or device).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      return { ok: false, error: "NOT_FOUND" };
    }
    throw error;
  }
}

async function updateInstallments(
  spaceId: string,
  id: string,
  input: EntryInput,
  scope: InstallmentScope,
  current: CurrentRefs & {
    type: string;
    method: string;
    amountCents: number;
    date: string;
    invoiceDueDate: string | null;
    installmentGroupId: string | null;
    installmentNumber: number | null;
  },
): Promise<TransactionResult> {
  const locked =
    input.type !== current.type ||
    input.method !== current.method ||
    input.cardId !== current.cardId ||
    input.date !== current.date ||
    input.installments !== null;
  if (locked) return { ok: false, error: "INSTALLMENT_LOCKED" };
  if (scope === "following" && input.amountCents !== current.amountCents) {
    return { ok: false, error: "INSTALLMENT_AMOUNT_SCOPE" };
  }
  // The invoice stays: installments follow the card's invoices, not a manual choice.
  // The date is locked (checked above), and later installments are dated in the future by
  // design: the "not in the future" rule doesn't apply to them.
  const today = todayInSaoPaulo();
  const checked = validateEntry(
    { ...input, invoiceDueDate: null, installments: null },
    await refsFor(spaceId, input),
    { today: current.date > today ? current.date : today, current },
  );
  if (!checked.ok) return checked;

  const counterpartyId = await counterpartyIdFor(spaceId, input);
  const shared = { categoryId: input.categoryId, counterpartyId, description: input.description };
  // All or nothing: "esta e as próximas" never ends half applied.
  const count = await db.$transaction(async (tx) => {
    const updated = await tx.transaction.updateMany({
      where: { id, spaceId },
      data: { ...shared, amountCents: input.amountCents },
    });
    if (updated.count > 0 && scope === "following") {
      await tx.transaction.updateMany({
        where: {
          spaceId,
          installmentGroupId: current.installmentGroupId,
          installmentNumber: { gt: current.installmentNumber! },
        },
        data: shared,
      });
    }
    return updated.count;
  });
  if (count === 0) return { ok: false, error: "NOT_FOUND" };
  const row = await db.transaction.findFirstOrThrow({
    where: { id, spaceId },
    select: transactionSelect,
  });
  return { ok: true, transaction: toTransaction(row) };
}

/**
 * Deletes an entry. For an installment, scope "following" also deletes the next ones of its
 * purchase (the earlier ones stay); "this" deletes only it, and the others keep their numbers.
 */
export async function deleteTransaction(
  spaceId: string,
  id: string,
  scope: InstallmentScope = "this",
): Promise<{ ok: true; count: number } | { ok: false; error: "NOT_FOUND" }> {
  const row = await db.transaction.findFirst({
    where: { id, spaceId },
    select: { installmentGroupId: true, installmentNumber: true },
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };
  const where =
    scope === "following" && row.installmentGroupId !== null
      ? {
          spaceId,
          installmentGroupId: row.installmentGroupId,
          installmentNumber: { gte: row.installmentNumber! },
        }
      : { id, spaceId };
  const { count } = await db.transaction.deleteMany({ where });
  return count > 0 ? { ok: true, count } : { ok: false, error: "NOT_FOUND" };
}

/** Today's balance (end of day in São Paulo) of every account in the space, by account id. */
export async function accountBalances(spaceId: string): Promise<Map<string, number>> {
  const today = todayInSaoPaulo();
  const [accounts, rows] = await Promise.all([
    db.account.findMany({
      where: { spaceId },
      select: {
        id: true,
        initialBalanceCents: true,
        initialBalanceDate: true,
        initialBalanceSetAt: true,
      },
    }),
    // Only what can move an account: credit purchases point to a card instead.
    db.transaction.findMany({
      where: {
        spaceId,
        date: { lte: calendarDateToDb(today) },
        OR: [{ accountId: { not: null } }, { toAccountId: { not: null } }],
      },
      select: {
        type: true,
        method: true,
        amountCents: true,
        date: true,
        accountId: true,
        toAccountId: true,
        createdAt: true,
      },
    }),
  ]);
  const entries: BalanceEntry[] = rows.map((r) => ({ ...r, date: dbToCalendarDate(r.date) }));
  return new Map(
    accounts.map((account) => [
      account.id,
      accountBalance(
        { ...account, initialBalanceDate: dbToCalendarDate(account.initialBalanceDate) },
        entries,
        today,
      ),
    ]),
  );
}
