import "server-only";

import {
  type AccountError,
  selectableAccountList,
  sortAccounts,
  validateAccount,
} from "@/domain/accounts";
import { calendarDateToDb, dbToCalendarDate, todayInSaoPaulo } from "@/domain/dates";
import { db } from "@/lib/db";
import type { AccountInput } from "@/lib/validation/accounts";

const accountSelect = {
  id: true,
  name: true,
  color: true,
  initialBalanceCents: true,
  initialBalanceDate: true,
  archivedAt: true,
} as const;

async function spaceAccounts(spaceId: string) {
  const rows = await db.account.findMany({ where: { spaceId }, select: accountSelect });
  return rows.map(toAccount);
}

function toAccount<T extends { initialBalanceDate: Date }>(row: T) {
  return { ...row, initialBalanceDate: dbToCalendarDate(row.initialBalanceDate) };
}

export type AccountRow = Awaited<ReturnType<typeof spaceAccounts>>[number];

export type AccountResult =
  { ok: true; account: AccountRow } | { ok: false; error: AccountError | "NOT_FOUND" };

/** The space's accounts in pt-BR order; archived ones only with `includeArchived`. */
export async function listAccounts(spaceId: string, { includeArchived = false } = {}) {
  const accounts = sortAccounts(await spaceAccounts(spaceId));
  return includeArchived ? accounts : accounts.filter((a) => a.archivedAt === null);
}

/** What an account picker offers. */
export async function selectableAccounts(spaceId: string) {
  return selectableAccountList(await spaceAccounts(spaceId));
}

export async function createAccount(spaceId: string, input: AccountInput): Promise<AccountResult> {
  const checked = validateAccount(input, await spaceAccounts(spaceId), todayInSaoPaulo());
  if (!checked.ok) return checked;

  const row = await db.account.create({
    data: { spaceId, ...input, initialBalanceDate: calendarDateToDb(input.initialBalanceDate) },
    select: accountSelect,
  });
  return { ok: true, account: toAccount(row) };
}

export async function updateAccount(
  spaceId: string,
  id: string,
  input: AccountInput,
): Promise<AccountResult> {
  const existing = await spaceAccounts(spaceId);
  if (!existing.some((a) => a.id === id)) return { ok: false, error: "NOT_FOUND" };

  const checked = validateAccount({ id, ...input }, existing, todayInSaoPaulo());
  if (!checked.ok) return checked;

  const current = existing.find((a) => a.id === id)!;
  const balanceChanged =
    current.initialBalanceCents !== input.initialBalanceCents ||
    current.initialBalanceDate !== input.initialBalanceDate;

  const row = await db.account.update({
    where: { id, spaceId },
    data: {
      ...input,
      initialBalanceDate: calendarDateToDb(input.initialBalanceDate),
      // A new balance already includes what was registered until now.
      ...(balanceChanged ? { initialBalanceSetAt: new Date() } : {}),
    },
    select: accountSelect,
  });
  return { ok: true, account: toAccount(row) };
}

export async function setAccountArchived(
  spaceId: string,
  id: string,
  archived: boolean,
): Promise<AccountResult> {
  const current = await db.account.findFirst({ where: { id, spaceId }, select: accountSelect });
  if (!current) return { ok: false, error: "NOT_FOUND" };

  const row = await db.account.update({
    where: { id, spaceId },
    data: { archivedAt: archived ? (current.archivedAt ?? new Date()) : null },
    select: accountSelect,
  });
  return { ok: true, account: toAccount(row) };
}
