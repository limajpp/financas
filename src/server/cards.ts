import "server-only";

import { type CardError, cycleChange, sortCards, validateCard } from "@/domain/cards";
import { calendarDateToDb, dbToCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { CYCLE_EPOCH, cycleOn, invoiceFor } from "@/domain/invoice-cycle";
import { recomputeInvoices } from "@/domain/transactions";
import { db } from "@/lib/db";
import type { CardInput } from "@/lib/validation/cards";

const cardInclude = {
  account: { select: { id: true, name: true, archivedAt: true } },
  cycles: { select: { closingDay: true, dueDay: true, validFrom: true } },
} as const;

type CardWithCycles = Awaited<ReturnType<typeof findCards>>[number];

function findCards(spaceId: string) {
  return db.card.findMany({ where: { spaceId }, include: cardInclude });
}

/** A card with its cycle history, the cycle valid today and today's open invoice. */
function toCard(card: CardWithCycles, today: string) {
  const cycles = card.cycles.map((c) => ({ ...c, validFrom: dbToCalendarDate(c.validFrom) }));
  const cycle = cycleOn(cycles, today);
  return {
    id: card.id,
    name: card.name,
    limitCents: card.limitCents,
    archivedAt: card.archivedAt,
    account: card.account,
    cycles,
    // Edits on the creation day correct the whole history (see cycleChange).
    createdToday: todayInSaoPaulo(card.createdAt) === today,
    closingDay: cycle.closingDay,
    dueDay: cycle.dueDay,
    openInvoice: invoiceFor(cycle, today),
  };
}

export type CardRow = ReturnType<typeof toCard>;

export type CardResult =
  { ok: true; card: CardRow } | { ok: false; error: CardError | "NOT_FOUND" };

async function spaceCards(spaceId: string) {
  const today = todayInSaoPaulo();
  return sortCards((await findCards(spaceId)).map((card) => toCard(card, today)));
}

function spaceAccounts(spaceId: string) {
  return db.account.findMany({ where: { spaceId }, select: { id: true, archivedAt: true } });
}

/** The space's cards in pt-BR order; archived ones only with `includeArchived`. */
export async function listCards(spaceId: string, { includeArchived = false } = {}) {
  const cards = await spaceCards(spaceId);
  return includeArchived ? cards : cards.filter((c) => c.archivedAt === null);
}

/** What a card picker offers. */
export async function selectableCards(spaceId: string) {
  return listCards(spaceId);
}

async function reload(spaceId: string, id: string): Promise<CardResult> {
  const card = await db.card.findFirstOrThrow({ where: { id, spaceId }, include: cardInclude });
  return { ok: true, card: toCard(card, todayInSaoPaulo()) };
}

export async function createCard(spaceId: string, input: CardInput): Promise<CardResult> {
  const [cards, accounts] = await Promise.all([findCards(spaceId), spaceAccounts(spaceId)]);
  const checked = validateCard(input, cards, accounts);
  if (!checked.ok) return checked;

  const card = await db.card.create({
    data: {
      spaceId,
      accountId: input.accountId,
      name: input.name,
      limitCents: input.limit,
      // The first version covers every past purchase (onboarding included).
      cycles: {
        create: {
          closingDay: input.closingDay,
          dueDay: input.dueDay,
          validFrom: calendarDateToDb(CYCLE_EPOCH),
        },
      },
    },
    select: { id: true },
  });
  return reload(spaceId, card.id);
}

/**
 * Changes name, account, limit and days. New days apply to purchases from today on: they go in a
 * new cycle version (replacing one that already starts today); older purchases keep theirs.
 * Purchases already registered from the version's start on get their invoice recomputed, except
 * the ones whose invoice was chosen by hand.
 */
export async function updateCard(
  spaceId: string,
  id: string,
  input: CardInput,
): Promise<CardResult> {
  const [cards, accounts] = await Promise.all([findCards(spaceId), spaceAccounts(spaceId)]);
  const current = cards.find((c) => c.id === id);
  if (!current) return { ok: false, error: "NOT_FOUND" };

  const checked = validateCard(
    { id, ...input, currentAccountId: current.accountId },
    cards,
    accounts,
  );
  if (!checked.ok) return checked;

  const today = todayInSaoPaulo();
  const { closingDay, dueDay, createdToday, cycles } = toCard(current, today);
  const change = cycleChange({ closingDay, dueDay }, input, today, { createdToday });

  await db.$transaction(async (tx) => {
    await tx.card.update({
      where: { id, spaceId },
      data: { accountId: input.accountId, name: input.name, limitCents: input.limit },
    });
    if (change) {
      const validFrom = calendarDateToDb(change.validFrom);
      await tx.cardCycle.upsert({
        where: { cardId_validFrom: { cardId: id, validFrom } },
        create: { cardId: id, closingDay: change.closingDay, dueDay: change.dueDay, validFrom },
        update: { closingDay: change.closingDay, dueDay: change.dueDay },
      });

      const purchases = await tx.transaction.findMany({
        where: {
          cardId: id,
          type: "EXPENSE",
          method: "CREDIT",
          invoiceOverridden: false,
          date: { gte: validFrom },
        },
        select: { id: true, date: true, invoiceDueDate: true },
      });
      const versions = [...cycles.filter((c) => c.validFrom !== change.validFrom), change];
      const updates = recomputeInvoices(
        versions,
        purchases.map((p) => ({
          id: p.id,
          date: dbToCalendarDate(p.date),
          invoiceDueDate: p.invoiceDueDate && dbToCalendarDate(p.invoiceDueDate),
        })),
      );
      for (const update of updates) {
        await tx.transaction.update({
          where: { id: update.id },
          data: { invoiceDueDate: calendarDateToDb(update.invoiceDueDate) },
        });
      }
    }
  });
  return reload(spaceId, id);
}

export async function setCardArchived(
  spaceId: string,
  id: string,
  archived: boolean,
): Promise<CardResult> {
  const current = await db.card.findFirst({ where: { id, spaceId }, select: { archivedAt: true } });
  if (!current) return { ok: false, error: "NOT_FOUND" };

  await db.card.update({
    where: { id, spaceId },
    data: { archivedAt: archived ? (current.archivedAt ?? new Date()) : null },
  });
  return reload(spaceId, id);
}
