import type { CalendarDate } from "@/domain/dates";

/** A card as the accounts screen receives it (serializable). */
export type CardView = {
  id: string;
  name: string;
  limitCents: number | null;
  archived: boolean;
  accountId: string;
  accountName: string;
  /** Created today: editing the days corrects them for every purchase. */
  createdToday: boolean;
  closingDay: number;
  dueDay: number;
  openInvoice: { closingDate: CalendarDate; dueDate: CalendarDate };
};

/** An account the card form can offer as the payer. */
export type PayerOption = { id: string; name: string; archived: boolean };
