ALTER TABLE "PlayerRelationship"
ADD COLUMN "lockedPair" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "PlayerRelationship_sessionId_lockedPair_idx" ON "PlayerRelationship"("sessionId", "lockedPair");
