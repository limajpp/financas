import { formatBRL } from "@/domain/money";
import { type InvoiceSummary, invoiceBalance } from "@/domain/invoices";
import { cn } from "@/lib/utils";

/** An invoice's total: a negative one (refunds beyond the purchases) is a credit. */
export function formatInvoiceTotal(cents: number) {
  return cents < 0 ? `${formatBRL(-cents)} de crédito` : formatBRL(cents);
}

/** "Aberta", "Futura", "Paga", "A pagar R$ 120,00" or "R$ 50,00 de crédito". */
export function invoiceStatusText(summary: InvoiceSummary, { short = false } = {}) {
  if (summary.status === "open") return "Aberta";
  if (summary.status === "future") return "Futura";
  const balance = invoiceBalance(summary);
  if (balance === "paid") return "Paga";
  if (balance === "credit") return `${formatBRL(-summary.remainingCents)} de crédito`;
  return short ? "A pagar" : `A pagar ${formatBRL(summary.remainingCents)}`;
}

/** The status as a small pill: something left to pay on a closed invoice stands out. */
export function InvoiceStatus({
  summary,
  short,
  className,
}: {
  summary: InvoiceSummary;
  short?: boolean;
  className?: string;
}) {
  const balance = invoiceBalance(summary);
  const closed = summary.status === "closed";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums",
        closed && balance === "due"
          ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
          : closed && balance === "credit"
            ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
            : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {invoiceStatusText(summary, { short })}
    </span>
  );
}
