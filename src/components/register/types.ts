import type { CalendarDate } from "@/domain/dates";
import type { CycleVersion } from "@/domain/invoice-cycle";
import type { PaymentChoice } from "@/domain/register";

/** A category as the register screen shows it. */
export type RegisterCategory = {
  id: string;
  parentId: string | null;
  name: string;
  icon: string;
  color: string;
};

export type RegisterCard = { id: string; name: string; cycles: CycleVersion[] };

/** What the register screen starts with for one type (serializable). */
export type RegisterTypeData = {
  tree: (RegisterCategory & { children: RegisterCategory[] })[];
  top: RegisterCategory[];
  payment: PaymentChoice | null;
};

export type RegisterProps = {
  accounts: { id: string; name: string }[];
  cards: RegisterCard[];
  EXPENSE: RegisterTypeData;
  INCOME: RegisterTypeData;
  today: CalendarDate;
};
