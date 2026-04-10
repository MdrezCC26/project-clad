-- New projects default to store pickup when no delivery details yet.
ALTER TABLE "Project" ALTER COLUMN "receiveMode" SET DEFAULT 'pickup'::"ProjectReceiveMode";
