import type { CalendarDate } from "@/domain/dates";

/** An account as the accounts screen receives it (serializable). */
export type AccountView = {
  id: string;
  name: string;
  color: string;
  initialBalanceCents: number;
  initialBalanceDate: CalendarDate;
  /** Today's balance: the initial one plus the entries after its day (src/domain/balance.ts). */
  currentBalanceCents: number;
  /** The last day the balance matched the bank's (task 21), or null when never reconciled. */
  reconciledOn: CalendarDate | null;
  archived: boolean;
};
