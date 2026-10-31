import type { CalendarDate } from "@/domain/dates";

/** An account as the accounts screen receives it (serializable). */
export type AccountView = {
  id: string;
  name: string;
  color: string;
  initialBalanceCents: number;
  initialBalanceDate: CalendarDate;
  archived: boolean;
};
