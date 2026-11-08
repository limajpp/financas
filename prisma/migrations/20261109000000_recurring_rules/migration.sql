-- CreateEnum
CREATE TYPE "RuleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELED');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "recurringMonth" TEXT,
ADD COLUMN     "recurringRuleId" TEXT;

-- CreateTable
CREATE TABLE "RecurringRule" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "accountId" TEXT,
    "cardId" TEXT,
    "categoryId" TEXT,
    "counterpartyId" TEXT,
    "description" TEXT,
    "status" "RuleStatus" NOT NULL DEFAULT 'ACTIVE',
    "canceledAt" TIMESTAMP(3),
    "firstMonth" TEXT NOT NULL,
    "nextMonth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringRuleChange" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "previousCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "changedOn" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringRuleChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringRule_spaceId_status_nextMonth_idx" ON "RecurringRule"("spaceId", "status", "nextMonth");

-- CreateIndex
CREATE INDEX "RecurringRule_accountId_idx" ON "RecurringRule"("accountId");

-- CreateIndex
CREATE INDEX "RecurringRule_cardId_idx" ON "RecurringRule"("cardId");

-- CreateIndex
CREATE INDEX "RecurringRule_categoryId_idx" ON "RecurringRule"("categoryId");

-- CreateIndex
CREATE INDEX "RecurringRule_counterpartyId_idx" ON "RecurringRule"("counterpartyId");

-- CreateIndex
CREATE INDEX "RecurringRule_createdById_idx" ON "RecurringRule"("createdById");

-- CreateIndex
CREATE INDEX "RecurringRuleChange_ruleId_createdAt_idx" ON "RecurringRuleChange"("ruleId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_recurringRuleId_recurringMonth_key" ON "Transaction"("recurringRuleId", "recurringMonth");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "RecurringRule"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_counterpartyId_fkey" FOREIGN KEY ("counterpartyId") REFERENCES "Counterparty"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRuleChange" ADD CONSTRAINT "RecurringRuleChange_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "RecurringRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A subscription charges a positive amount on a day 1–31 (docs/specs/tasks/13-subscriptions.md),
-- with an expense's combinations: on credit a card and no account, else an account and no card.
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_shape_check" CHECK (
  "amountCents" > 0
  AND "dayOfMonth" BETWEEN 1 AND 31
  AND (
    ("method" = 'CREDIT' AND "cardId" IS NOT NULL AND "accountId" IS NULL)
    OR ("method" <> 'CREDIT' AND "accountId" IS NOT NULL AND "cardId" IS NULL)
  )
  AND "firstMonth" ~ '^\d{4}-\d{2}$' AND "nextMonth" ~ '^\d{4}-\d{2}$'
);

-- A charge of a subscription is an expense and names its month.
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_recurring_check" CHECK (
  ("recurringRuleId" IS NULL AND "recurringMonth" IS NULL)
  OR ("recurringRuleId" IS NOT NULL AND "recurringMonth" ~ '^\d{4}-\d{2}$' AND "type" = 'EXPENSE')
);
