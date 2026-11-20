import type { CalendarDate } from "@/domain/dates";
import type { InvoiceSummary } from "@/domain/invoices";

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
  /** What the "Pagar fatura" dialog starts with (task 11). */
  payment: {
    invoices: InvoiceSummary[];
    defaultDueDate: CalendarDate | null;
    accountId: string;
    method: string;
  };
};

/** An account the card form can offer as the payer. */
export type PayerOption = { id: string; name: string; archived: boolean };
