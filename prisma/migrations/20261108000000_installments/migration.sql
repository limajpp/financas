-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "installmentGroupId" TEXT,
ADD COLUMN     "installmentNumber" INTEGER,
ADD COLUMN     "installmentTotal" INTEGER;

-- CreateIndex
CREATE INDEX "Transaction_installmentGroupId_idx" ON "Transaction"("installmentGroupId");

-- An installment belongs to a credit purchase in 2–24 installments, numbered 1…N; the three
-- fields go together (docs/specs/tasks/12-installments.md).
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_installments_check" CHECK (
  ("installmentGroupId" IS NULL AND "installmentNumber" IS NULL AND "installmentTotal" IS NULL)
  OR (
    "installmentGroupId" IS NOT NULL AND "installmentNumber" IS NOT NULL
    AND "installmentTotal" IS NOT NULL
    AND "type" = 'EXPENSE' AND "method" = 'CREDIT'
    AND "installmentTotal" BETWEEN 2 AND 24
    AND "installmentNumber" BETWEEN 1 AND "installmentTotal"
  )
);
