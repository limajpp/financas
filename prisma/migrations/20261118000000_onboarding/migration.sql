-- The first use (docs/specs/tasks/22-onboarding.md).

-- When the onboarding was finished (or dismissed). A space that already has an account was set up
-- before the onboarding existed: it never sees it.
ALTER TABLE "Space" ADD COLUMN "onboardedAt" TIMESTAMP(3);

UPDATE "Space" SET "onboardedAt" = CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "Account" WHERE "Account"."spaceId" = "Space"."id");

-- An adjustment is also an invoice's amount from before the app: an expense on credit, on a card.
-- Either way, no category, counterparty, installments or subscription.
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_adjustment_check";

ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_adjustment_check" CHECK (
  NOT "adjustment" OR (
    (
      ("type" IN ('EXPENSE', 'INCOME') AND "method" <> 'CREDIT' AND "accountId" IS NOT NULL)
      OR ("type" = 'EXPENSE' AND "method" = 'CREDIT' AND "cardId" IS NOT NULL)
    )
    AND "categoryId" IS NULL AND "counterpartyId" IS NULL
    AND "installmentGroupId" IS NULL AND "recurringRuleId" IS NULL
  )
);
