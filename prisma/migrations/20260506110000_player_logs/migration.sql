CREATE TYPE "PlayerLogType" AS ENUM (
  'ARRIVED',
  'RESTED',
  'MATCH_STARTED',
  'MATCH_WON',
  'MATCH_LOST',
  'MATCH_DRAW',
  'MATCH_CANCELED',
  'LEFT',
  'RETURNED'
);

CREATE TABLE "PlayerLog" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "playerId" TEXT NOT NULL,
  "matchId" TEXT,
  "type" "PlayerLogType" NOT NULL,
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlayerLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PlayerLog_sessionId_playerId_createdAt_idx" ON "PlayerLog"("sessionId", "playerId", "createdAt");
CREATE INDEX "PlayerLog_matchId_idx" ON "PlayerLog"("matchId");

ALTER TABLE "PlayerLog"
ADD CONSTRAINT "PlayerLog_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "Session"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PlayerLog"
ADD CONSTRAINT "PlayerLog_playerId_fkey"
FOREIGN KEY ("playerId") REFERENCES "Player"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
