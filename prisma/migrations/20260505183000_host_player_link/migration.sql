ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "userId" TEXT;

CREATE INDEX IF NOT EXISTS "Player_userId_idx" ON "Player"("userId");

CREATE UNIQUE INDEX IF NOT EXISTS "Player_sessionId_userId_key"
ON "Player"("sessionId", "userId")
WHERE "userId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Player_userId_fkey'
  ) THEN
    ALTER TABLE "Player"
    ADD CONSTRAINT "Player_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
