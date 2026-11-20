import "server-only";

import {
  type CalendarDate,
  calendarDateToDb,
  dbToCalendarDate,
  todayInSaoPaulo,
} from "@/domain/dates";
import type { CycleVersion } from "@/domain/invoice-cycle";
import {
  ONGOING_CLIENT_ID_PREFIX,
  OPENING_CLIENT_ID_PREFIX,
  OPENING_BALANCE_DESCRIPTION,
  type OngoingError,
  type OngoingPurchaseInput,
  type SubscriptionRuleInput,
  firstChargeMonth,
  ongoingClientId,
  ongoingInstallments,
  openingBalanceCents,
  openingBalanceClientId,
  openingInvoices,
  validateOngoing,
} from "@/domain/onboarding";
import { validateRuleEdit } from "@/domain/subscriptions";
import { type TransactionError, validateEntry } from "@/domain/transactions";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { listAccounts } from "@/server/accounts";
import { listCards } from "@/server/cards";
import { selectableCategories } from "@/server/categories";
import { accountBalances, cardsInvoices, counterpartyIdFor, refsFor } from "@/server/transactions";

type Tx = Prisma.TransactionClient;

export type OnboardingError = TransactionError | OngoingError | "DUPLICATE_SUBSCRIPTION";

/** A card of the space, active, with its cycles; null when it isn't one. */
async function activeCard(spaceId: string, cardId: string) {
  const card = await db.card.findFirst({
    where: { id: cardId, spaceId },
    select: {
      id: true,
      archivedAt: true,
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

/**
 * What the app already has on one invoice of a card, besides its opening balance: credit purchases
 * (the onboarding's installments, entries registered since, subscription charges) minus refunds.
 * The amount the bank shows already includes all of them.
 */
async function entriesOnInvoice(
  client: Tx | typeof db,
  spaceId: string,
  cardId: string,
  dueDate: CalendarDate,
) {
  const groups = await client.transaction.groupBy({
    by: ["type"],
    where: {
      spaceId,
      cardId,
      method: "CREDIT",
      type: { in: ["EXPENSE", "INCOME"] },
      adjustment: false,
      invoiceDueDate: calendarDateToDb(dueDate),
    },
    _sum: { amountCents: true },
  });
  return groups.reduce(
    (net, g) => net + (g.type === "INCOME" ? -1 : 1) * (g._sum.amountCents ?? 0),
    0,
  );
}

/**
 * Writes an invoice's opening balance as `cents` (the adjustment of task 22): replaces the one
 * there, or deletes it at zero. The card must be locked by the caller.
 */
async function writeOpeningBalance(
  tx: Tx,
  spaceId: string,
  userId: string,
  cardId: string,
  dueDate: CalendarDate,
  cents: number,
) {
  const clientId = openingBalanceClientId(cardId, dueDate);
  const where = { spaceId_clientId: { spaceId, clientId } };
  if (cents === 0) {
    await tx.transaction.deleteMany({ where: { spaceId, clientId, adjustment: true } });
    return;
  }
  const existing = await tx.transaction.findUnique({ where, select: { id: true } });
  if (existing) {
    await tx.transaction.update({ where: { id: existing.id }, data: { amountCents: cents } });
    return;
  }
  await tx.transaction.create({
    data: {
      spaceId,
      clientId,
      createdById: userId,
      type: "EXPENSE",
      amountCents: cents,
      date: calendarDateToDb(todayInSaoPaulo()),
      method: "CREDIT",
      cardId,
      invoiceDueDate: calendarDateToDb(dueDate),
      // A chosen invoice: a later change of the card's days doesn't move it.
      invoiceOverridden: true,
      description: OPENING_BALANCE_DESCRIPTION,
      adjustment: true,
    },
  });
}

const lockCard = (tx: Tx, cardId: string) =>
  // NO KEY UPDATE: it serializes the two writers but, unlike FOR UPDATE, doesn't conflict with
  // the key-share lock a new row referencing the card takes (no deadlock with other inserts).
  tx.$queryRaw`SELECT "id" FROM "Card" WHERE "id" = ${cardId} FOR NO KEY UPDATE`;

/**
 * Records what the bank shows on one of a card's invoices today (the open one, or the closed one
 * not due yet). What stays as the opening balance is that amount minus what the app already has on
 * that invoice (the onboarding's installments, entries registered since, subscription charges):
 * the bank's amount includes them. Saving again replaces it; zero deletes.
 */
export async function setOpeningBalance(
  spaceId: string,
  userId: string,
  cardId: string,
  dueDate: CalendarDate,
  informedCents: number,
): Promise<{ ok: true; openingCents: number } | { ok: false; error: TransactionError }> {
  const card = await activeCard(spaceId, cardId);
  if (!card) return { ok: false, error: "CARD_NOT_FOUND" };
  if (card.archivedAt) return { ok: false, error: "CARD_ARCHIVED" };
  const { open, closed } = openingInvoices(card.cycles, todayInSaoPaulo());
  if (dueDate !== open.dueDate && dueDate !== closed?.dueDate) {
    return { ok: false, error: "INVALID_INVOICE" };
  }
  const openingCents = await db.$transaction(async (tx) => {
    // The installments of the same card wait: both read and write the opening balance.
    await lockCard(tx, cardId);
    const cents = openingBalanceCents(
      informedCents,
      await entriesOnInvoice(tx, spaceId, cardId, dueDate),
    );
    await writeOpeningBalance(tx, spaceId, userId, cardId, dueDate, cents);
    return cents;
  });
  return { ok: true, openingCents };
}

/**
 * Creates the installments left of a purchase made before the app (idempotent by `clientId`):
 * from the current one, on the open invoice, to the last. The current one is already in the
 * amount the bank shows for the open invoice, so it comes off that invoice's opening balance, which
 * never goes negative. All in one database transaction. Returns how much came off.
 */
export async function createOngoingInstallments(
  spaceId: string,
  userId: string,
  clientId: string,
  input: OngoingPurchaseInput,
): Promise<
  | { ok: true; created: boolean; deductedCents: number }
  | { ok: false; error: TransactionError | OngoingError }
> {
  const firstClientId = ongoingClientId(clientId, input.current, input.current);
  if (await findOngoing(spaceId, firstClientId))
    return { ok: true, created: false, deductedCents: 0 };

  const checkedOngoing = validateOngoing(input);
  if (!checkedOngoing.ok) return checkedOngoing;
  const today = todayInSaoPaulo();
  const entry = {
    type: "EXPENSE" as const,
    amountCents: input.amountCents,
    date: today,
    method: "CREDIT" as const,
    accountId: null,
    cardId: input.cardId,
    invoiceDueDate: null,
    categoryId: input.categoryId,
    counterparty: input.counterparty,
    counterpartyAlias: null,
    counterpartyDocument: null,
    description: null,
    installments: null,
    subscription: false,
  };
  const refs = await refsFor(spaceId, entry);
  const checked = validateEntry(entry, refs, { today });
  if (!checked.ok) return checked;
  const cycles: CycleVersion[] = refs.cards[0]!.cycles.map((c) => ({ ...c }));
  const plan = ongoingInstallments(input, cycles, today);
  const counterpartyId = await counterpartyIdFor(spaceId, entry);
  const installmentGroupId = crypto.randomUUID();
  const openDueDate = plan[0]!.invoiceDueDate;

  try {
    const deductedCents = await db.$transaction(async (tx) => {
      await lockCard(tx, input.cardId);
      // A retry whose first try went through while this one waited.
      if (await findOngoing(spaceId, firstClientId, tx)) return null;
      await tx.transaction.createMany({
        data: plan.map((installment) => ({
          spaceId,
          clientId: ongoingClientId(clientId, installment.number, input.current),
          createdById: userId,
          type: "EXPENSE" as const,
          amountCents: installment.amountCents,
          date: calendarDateToDb(installment.date),
          method: "CREDIT" as const,
          cardId: input.cardId,
          invoiceDueDate: calendarDateToDb(installment.invoiceDueDate),
          categoryId: input.categoryId,
          counterpartyId,
          installmentGroupId,
          installmentNumber: installment.number,
          installmentTotal: input.total,
        })),
      });
      const opening = await tx.transaction.findUnique({
        where: {
          spaceId_clientId: {
            spaceId,
            clientId: openingBalanceClientId(input.cardId, openDueDate),
          },
        },
        select: { amountCents: true },
      });
      if (!opening) return 0;
      const left = openingBalanceCents(opening.amountCents, plan[0]!.amountCents);
      await writeOpeningBalance(tx, spaceId, userId, input.cardId, openDueDate, left);
      return opening.amountCents - left;
    });
    return deductedCents === null
      ? { ok: true, created: false, deductedCents: 0 }
      : { ok: true, created: true, deductedCents };
  } catch (error) {
    // The same clientId at the same instant (a double tap): the other one went through.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002" &&
      (await findOngoing(spaceId, firstClientId))
    ) {
      return { ok: true, created: false, deductedCents: 0 };
    }
    throw error;
  }
}

function findOngoing(spaceId: string, clientId: string, client: Tx | typeof db = db) {
  return client.transaction.findUnique({
    where: { spaceId_clientId: { spaceId, clientId } },
    select: { id: true },
  });
}

/**
 * Creates a subscription that was already running before the app: only the rule, no charge now.
 * Its first charge is the first date after today (the past ones are in the balances). Checked
 * like a subscription edit (task 19); the counterparty is found or created like on the register.
 * The same active subscription twice (a double tap) is refused.
 */
export async function createSubscriptionRule(
  spaceId: string,
  userId: string,
  input: SubscriptionRuleInput,
): Promise<{ ok: true; id: string } | { ok: false; error: OnboardingError }> {
  const today = todayInSaoPaulo();
  const entry = {
    type: "EXPENSE" as const,
    amountCents: input.amountCents,
    date: today,
    method: input.method,
    accountId: input.accountId,
    cardId: input.cardId,
    invoiceDueDate: null,
    categoryId: input.categoryId,
    counterparty: input.counterparty,
    counterpartyAlias: null,
    counterpartyDocument: null,
    description: input.description,
    installments: null,
    subscription: false,
  };
  const refs = await refsFor(spaceId, entry);
  const none = { accountId: null, cardId: null, categoryId: null };
  const checked = validateRuleEdit(input, refs, none, today);
  if (!checked.ok) return checked;
  const counterpartyId = await counterpartyIdFor(spaceId, entry);
  const month = firstChargeMonth(input.dayOfMonth, today);
  const rule = {
    amountCents: input.amountCents,
    dayOfMonth: input.dayOfMonth,
    method: input.method,
    accountId: input.accountId,
    cardId: input.cardId,
    counterpartyId,
  };

  return db.$transaction(async (tx) => {
    // Two taps at once: the space row serializes them, and the second finds the first.
    // NO KEY UPDATE: doesn't block the inserts of the space, which only take a key-share lock.
    await tx.$queryRaw`SELECT "id" FROM "Space" WHERE "id" = ${spaceId} FOR NO KEY UPDATE`;
    const twin = await tx.recurringRule.findFirst({
      where: { spaceId, status: "ACTIVE", ...rule },
      select: { id: true },
    });
    if (twin) return { ok: false as const, error: "DUPLICATE_SUBSCRIPTION" as const };
    const created = await tx.recurringRule.create({
      data: {
        spaceId,
        createdById: userId,
        ...rule,
        categoryId: input.categoryId,
        description: input.description,
        firstMonth: month,
        nextMonth: month,
      },
      select: { id: true },
    });
    return { ok: true as const, id: created.id };
  });
}

/** Marks the space as set up: the onboarding isn't offered anymore. */
export async function finishOnboarding(spaceId: string) {
  await db.space.updateMany({
    where: { id: spaceId, onboardedAt: null },
    data: { onboardedAt: new Date() },
  });
}

/** Whether the space still has the onboarding to offer. */
export async function needsOnboarding(spaceId: string) {
  const space = await db.space.findUnique({
    where: { id: spaceId },
    select: { onboardedAt: true },
  });
  return space !== null && space.onboardedAt === null;
}

/**
 * What the onboarding screen shows (task 22): what each step already has, and what its forms
 * offer. Active accounts and cards only; each card with the invoices it asks about and what was
 * informed for them.
 */
export async function onboardingData(spaceId: string) {
  const today = todayInSaoPaulo();
  const [accounts, cards, balances, categories, ongoingRows, rules] = await Promise.all([
    listAccounts(spaceId),
    listCards(spaceId),
    accountBalances(spaceId),
    selectableCategories(spaceId, "EXPENSE"),
    db.transaction.findMany({
      where: {
        spaceId,
        OR: [
          { clientId: { startsWith: ONGOING_CLIENT_ID_PREFIX } },
          { clientId: { startsWith: OPENING_CLIENT_ID_PREFIX }, adjustment: true },
        ],
      },
      orderBy: [{ createdAt: "asc" }, { installmentNumber: "asc" }],
      select: {
        cardId: true,
        invoiceDueDate: true,
        amountCents: true,
        adjustment: true,
        installmentGroupId: true,
        installmentNumber: true,
        installmentTotal: true,
        counterparty: { select: { name: true } },
        category: { select: { name: true } },
      },
    }),
    db.recurringRule.findMany({
      where: { spaceId, status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        amountCents: true,
        dayOfMonth: true,
        method: true,
        description: true,
        account: { select: { name: true } },
        card: { select: { name: true } },
        counterparty: { select: { name: true } },
      },
    }),
  ]);

  const invoices = await cardsInvoices(
    spaceId,
    cards.map((card) => ({ id: card.id, accountId: card.account.id, cycles: card.cycles })),
  );
  // What was informed: with an opening balance, the invoice's total (the opening balance plus what
  // the app has on it, which is what came off the informed amount).
  const informed = (cardId: string, dueDate: CalendarDate) => {
    const hasOpening = ongoingRows.some(
      (r) =>
        r.adjustment &&
        r.cardId === cardId &&
        r.invoiceDueDate &&
        dbToCalendarDate(r.invoiceDueDate) === dueDate,
    );
    if (!hasOpening) return null;
    return invoices.get(cardId)?.invoices.find((i) => i.dueDate === dueDate)?.totalCents ?? null;
  };

  // One entry per purchase: its first installment left.
  const purchases = new Map<string, (typeof ongoingRows)[number]>();
  for (const row of ongoingRows) {
    if (!row.installmentGroupId || purchases.has(row.installmentGroupId)) continue;
    purchases.set(row.installmentGroupId, row);
  }
  const cardName = new Map(cards.map((c) => [c.id, c.name]));

  return {
    today,
    accounts: accounts.map((a) => ({
      id: a.id,
      name: a.name,
      color: a.color,
      balanceCents: balances.get(a.id) ?? a.initialBalanceCents,
    })),
    cards: cards.map((card) => {
      const { open, closed } = openingInvoices(card.cycles, today);
      return {
        id: card.id,
        name: card.name,
        accountName: card.account.name,
        open: { ...open, informedCents: informed(card.id, open.dueDate) },
        closed: closed && { ...closed, informedCents: informed(card.id, closed.dueDate) },
      };
    }),
    purchases: [...purchases.values()].map((row) => ({
      id: row.installmentGroupId!,
      cardName: (row.cardId && cardName.get(row.cardId)) ?? "Cartão arquivado",
      name: row.counterparty?.name ?? row.category?.name ?? "Compra parcelada",
      current: row.installmentNumber!,
      total: row.installmentTotal!,
      amountCents: row.amountCents,
    })),
    subscriptions: rules.map((rule) => ({
      id: rule.id,
      name: rule.counterparty?.name ?? rule.description ?? "Assinatura",
      amountCents: rule.amountCents,
      dayOfMonth: rule.dayOfMonth,
      place: rule.card?.name ?? rule.account?.name ?? "",
      method: rule.method,
    })),
    categories: categories.map((parent) => ({
      id: parent.id,
      name: parent.name,
      children: parent.children.map((child) => ({ id: child.id, name: child.name })),
    })),
  };
}

export type OnboardingData = Awaited<ReturnType<typeof onboardingData>>;
