-- AlterTable
ALTER TABLE "RecurrenceRule" ADD COLUMN     "syncToDueDate" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "triggerStatus" "Status" NOT NULL DEFAULT 'REVIEWED';
