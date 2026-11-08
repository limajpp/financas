/** How the list shows an entry (pure: no server or React imports). */
import { formatBRL } from "@/domain/money";
import { PAYMENT_METHOD_LABELS } from "@/domain/transactions";

import type { ListItemView } from "./types";

export const TYPE_LABELS = {
  EXPENSE: "Despesa",
  INCOME: "Receita",
  TRANSFER: "Transferência",
  CARD_PAYMENT: "Pagamento de fatura",
} as const;

/** What a row says: its title, the line under it and the signed amount. */
export function describeItem(item: ListItemView) {
  const title =
    item.counterparty?.name ??
    item.description ??
    (item.type === "TRANSFER" || item.type === "CARD_PAYMENT"
      ? TYPE_LABELS[item.type]
      : (item.category?.name ?? TYPE_LABELS[item.type]));
  let line: string;
  if (item.type === "TRANSFER") {
    line = `${item.account?.name} → ${item.toAccount?.name}`;
  } else if (item.type === "CARD_PAYMENT") {
    line = `Pagamento · ${item.card?.name}`;
  } else if (item.card) {
    line = item.installmentNumber
      ? `${item.card.name} · ${item.installmentNumber}/${item.installmentTotal}`
      : `${item.card.name} · ${PAYMENT_METHOD_LABELS[item.method]}`;
  } else {
    line = `${item.account?.name} · ${PAYMENT_METHOD_LABELS[item.method]}`;
  }
  if (item.recurringRuleId) line += " · Assinatura";
  const sign = item.type === "EXPENSE" ? "−" : item.type === "INCOME" ? "+" : "";
  return { title, line, amount: `${sign}${formatBRL(item.amountCents)}` };
}
