-- Reconciling an account with the bank (docs/specs/tasks/21-reconcile-balance.md).

-- The last day the balance matched the bank's, and the bank's balance then.
ALTER TABLE "Account" ADD COLUMN "reconciledOn" DATE,
ADD COLUMN "reconciledBalanceCents" INTEGER;

-- A balance adjustment: an expense or income on an account (never credit), with no category,
-- counterparty, installments or subscription. It moves the balance but stays out of the indicators.
ALTER TABLE "Transaction" ADD COLUMN "adjustment" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_adjustment_check" CHECK (
  NOT "adjustment" OR (
    "type" IN ('EXPENSE', 'INCOME') AND "method" <> 'CREDIT' AND "accountId" IS NOT NULL
    AND "categoryId" IS NULL AND "counterpartyId" IS NULL
    AND "installmentGroupId" IS NULL AND "recurringRuleId" IS NULL
  )
);
