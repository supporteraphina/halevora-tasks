-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "nextRunAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AutomationRule_nextRunAt_idx" ON "AutomationRule"("nextRunAt");
