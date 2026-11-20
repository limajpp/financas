-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "limitCents" INTEGER,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardCycle" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "closingDay" INTEGER NOT NULL,
    "dueDay" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardCycle_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Card_spaceId_idx" ON "Card"("spaceId");

-- CreateIndex
CREATE INDEX "Card_accountId_idx" ON "Card"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CardCycle_cardId_validFrom_key" ON "CardCycle"("cardId", "validFrom");

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "Space"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCycle" ADD CONSTRAINT "CardCycle_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Cycle days are 1–31; a day the month lacks means its last day (src/domain/invoice-cycle.ts).
ALTER TABLE "CardCycle" ADD CONSTRAINT "CardCycle_days_check"
  CHECK ("closingDay" BETWEEN 1 AND 31 AND "dueDay" BETWEEN 1 AND 31);

-- A limit, when set, is positive.
ALTER TABLE "Card" ADD CONSTRAINT "Card_limitCents_check" CHECK ("limitCents" IS NULL OR "limitCents" > 0);
