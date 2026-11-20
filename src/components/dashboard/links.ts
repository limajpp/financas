/** Where each piece of the dashboard leads (task 25). Pure: no server or React imports. */
import { monthDays } from "@/domain/dashboard";
import type { InsightSubject } from "@/domain/insights";
import type { Month } from "@/domain/recurring";
import { FILTER_PARAMS } from "@/lib/validation/transaction-filters";

/** The month's entries of a category (a main one includes its children); null: uncategorized. */
export function categoryEntriesHref(categoryId: string | null, month: Month): string {
  const { from, to } = monthDays(month);
  const params = new URLSearchParams({
    [FILTER_PARAMS.categoryId]: categoryId ?? "none",
    [FILTER_PARAMS.from]: from,
    [FILTER_PARAMS.to]: to,
  });
  return `/lancamentos?${params}`;
}

/** An insight's subject: the category's entries of the month, the counterparty, the subscriptions. */
export function insightHref(subject: InsightSubject, month: Month): string {
  switch (subject.type) {
    case "category":
      return categoryEntriesHref(subject.id, month);
    case "counterparty":
      return `/estabelecimentos/${subject.id}`;
    case "subscription":
    case "subscriptions":
      return "/assinaturas";
  }
}

/** The dashboard of a month; today's month is the plain "/". */
export function monthHref(month: Month, current: boolean): string {
  return current ? "/" : `/?mes=${month}`;
}
