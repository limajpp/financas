-- A refund on a card (docs/specs/tasks/18-invoices.md) is an income on credit: like a credit
-- purchase, it points to a card and an invoice, never to an account (so it can't touch a balance).
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_shape_check";

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_shape_check" CHECK (
  CASE "type"
    WHEN 'EXPENSE' THEN "toAccountId" IS NULL AND (
      ("method" = 'CREDIT' AND "cardId" IS NOT NULL AND "accountId" IS NULL
        AND "invoiceDueDate" IS NOT NULL)
      OR ("method" <> 'CREDIT' AND "accountId" IS NOT NULL AND "cardId" IS NULL
        AND "invoiceDueDate" IS NULL AND NOT "invoiceOverridden"))
    WHEN 'INCOME' THEN "toAccountId" IS NULL AND (
      ("method" = 'CREDIT' AND "cardId" IS NOT NULL AND "accountId" IS NULL
        AND "invoiceDueDate" IS NOT NULL)
      OR ("method" IN ('PIX', 'TED', 'CASH', 'BOLETO') AND "accountId" IS NOT NULL
        AND "cardId" IS NULL AND "invoiceDueDate" IS NULL AND NOT "invoiceOverridden"))
    WHEN 'TRANSFER' THEN "method" <> 'CREDIT'
      AND "accountId" IS NOT NULL AND "toAccountId" IS NOT NULL AND "accountId" <> "toAccountId"
      AND "cardId" IS NULL AND "invoiceDueDate" IS NULL AND NOT "invoiceOverridden"
    WHEN 'CARD_PAYMENT' THEN "method" <> 'CREDIT'
      AND "accountId" IS NOT NULL AND "cardId" IS NOT NULL AND "invoiceDueDate" IS NOT NULL
      AND "toAccountId" IS NULL
  END
);
