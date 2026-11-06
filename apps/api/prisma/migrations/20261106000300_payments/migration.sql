CREATE TABLE "Payment" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "reference" VARCHAR(100) NOT NULL,
  "plan" VARCHAR(20) NOT NULL,
  "amount" INTEGER NOT NULL,
  "channel" VARCHAR(20) NOT NULL,
  "paidAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Payment_amount_positive" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "Payment_reference_key" ON "Payment"("reference");
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");
