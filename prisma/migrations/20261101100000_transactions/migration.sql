-- CreateEnum
CREATE TYPE "TransactionType" AS ENUM ('EXPENSE', 'INCOME', 'TRANSFER', 'CARD_PAYMENT');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('PIX', 'DEBIT', 'CREDIT', 'CASH', 'BOLETO', 'TED');

-- CreateTable
CREATE TABLE "Counterparty" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "document" TEXT,
    "defaultDescription" TEXT,
    "defaultCategoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Counterparty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "type" "TransactionType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "accountId" TEXT,
    "toAccountId" TEXT,
    "cardId" TEXT,
    "invoiceDueDate" DATE,
    "invoiceOverridden" BOOLEAN NOT NULL DEFAULT false,
    "categoryId" TEXT,
    "counterpartyId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Counterparty_defaultCategoryId_idx" ON "Counterparty"("defaultCategoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Counterparty_spaceId_nameKey_key" ON "Counterparty"("spaceId", "nameKey");

-- CreateIndex
CREATE INDEX "Transaction_spaceId_date_idx" ON "Transaction"("spaceId", "date");

-- CreateIndex
CREATE INDEX "Transaction_accountId_idx" ON "Transaction"("accountId");

-- CreateIndex
CREATE INDEX "Transaction_toAccountId_idx" ON "Transaction"("toAccountId");

-- CreateIndex
CREATE INDEX "Transaction_cardId_invoiceDueDate_idx" ON "Transaction"("cardId", "invoiceDueDate");

-- CreateIndex
CREATE INDEX "Transaction_categoryId_idx" ON "Transaction"("categoryId");

-- CreateIndex
CREATE INDEX "Transaction_counterpartyId_idx" ON "Transaction"("counterpartyId");

-- CreateIndex
CREATE INDEX "Transaction_createdById_idx" ON "Transaction"("createdById");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_spaceId_clientId_key" ON "Transaction"("spaceId", "clientId");

-- AddForeignKey
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Counterparty" ADD CONSTRAINT "Counterparty_defaultCategoryId_fkey" FOREIGN KEY ("defaultCategoryId") REFERENCES "Category"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- Amounts are positive; the type gives the direction (src/domain/balance.ts).
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_amountCents_check" CHECK ("amountCents" > 0);

-- Where the money is, per type (docs/specs/tasks/08-transactions.md):
-- a credit purchase points to a card and an invoice, never to an account (so it can't touch a
-- balance); everything else moves an account.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_shape_check" CHECK (
  CASE "type"
    WHEN 'EXPENSE' THEN "toAccountId" IS NULL AND (
      ("method" = 'CREDIT' AND "cardId" IS NOT NULL AND "accountId" IS NULL
        AND "invoiceDueDate" IS NOT NULL)
      OR ("method" <> 'CREDIT' AND "accountId" IS NOT NULL AND "cardId" IS NULL
        AND "invoiceDueDate" IS NULL AND NOT "invoiceOverridden"))
    WHEN 'INCOME' THEN "method" IN ('PIX', 'TED', 'CASH', 'BOLETO')
      AND "accountId" IS NOT NULL AND "cardId" IS NULL AND "toAccountId" IS NULL
      AND "invoiceDueDate" IS NULL AND NOT "invoiceOverridden"
    WHEN 'TRANSFER' THEN "method" <> 'CREDIT'
      AND "accountId" IS NOT NULL AND "toAccountId" IS NOT NULL AND "accountId" <> "toAccountId"
      AND "cardId" IS NULL AND "invoiceDueDate" IS NULL AND NOT "invoiceOverridden"
    WHEN 'CARD_PAYMENT' THEN "method" <> 'CREDIT'
      AND "accountId" IS NOT NULL AND "cardId" IS NOT NULL AND "invoiceDueDate" IS NOT NULL
      AND "toAccountId" IS NULL
  END
);
