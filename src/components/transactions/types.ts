import type { CycleVersion } from "@/domain/invoice-cycle";
import type { CounterpartyOption, RegisterTypeData } from "@/components/register/types";
import type { ListPage } from "@/server/transaction-list";

export type ListItemView = ListPage["items"][number];
export type ListPageView = ListPage;

/** What the list's filters and edit form offer (serializable). */
export type ListOptions = {
  accounts: { id: string; name: string; archived: boolean }[];
  cards: { id: string; name: string; archived: boolean; cycles: CycleVersion[] }[];
  categories: { EXPENSE: RegisterTypeData["tree"]; INCOME: RegisterTypeData["tree"] };
  counterparties: CounterpartyOption[];
};
