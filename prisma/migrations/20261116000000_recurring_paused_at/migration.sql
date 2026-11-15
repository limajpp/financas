-- When a subscription was paused, for "Pausada desde" (docs/specs/tasks/19-subscriptions-screen.md).
-- Rules paused before this column existed show their last update instead.
ALTER TABLE "RecurringRule" ADD COLUMN "pausedAt" TIMESTAMP(3);

UPDATE "RecurringRule" SET "pausedAt" = "updatedAt" WHERE "status" = 'PAUSED';
