ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "joinCode" TEXT;

UPDATE "Session"
SET "joinCode" = upper(substr(md5(random()::text || "id"), 1, 6))
WHERE "joinCode" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Session_joinCode_key" ON "Session"("joinCode");
