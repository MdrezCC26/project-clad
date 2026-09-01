-- Track payment reminder cadence for invoiced-but-unpaid orders.
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "paymentReminderLastSentAt" TIMESTAMP(3);
