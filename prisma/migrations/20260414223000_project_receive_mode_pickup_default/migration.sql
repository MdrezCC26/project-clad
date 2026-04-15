-- Align DB default with Prisma @default(pickup) after receiveMode column exists (20260410180000).
ALTER TABLE "Project" ALTER COLUMN "receiveMode" SET DEFAULT 'pickup'::"ProjectReceiveMode";
