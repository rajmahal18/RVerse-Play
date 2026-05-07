ALTER TYPE "SkillLevel" RENAME TO "SkillLevel_old";

CREATE TYPE "SkillLevel" AS ENUM (
    'BEGINNER',
    'LOW_NOVICE',
    'HIGH_NOVICE',
    'LOW_INTERMEDIATE',
    'HIGH_INTERMEDIATE',
    'OPEN'
);

ALTER TABLE "Player"
ALTER COLUMN "skillLevel" DROP DEFAULT;

ALTER TABLE "Player"
ALTER COLUMN "skillLevel" TYPE "SkillLevel"
USING (
    CASE "skillLevel"::text
        WHEN 'BEGINNER' THEN 'BEGINNER'::"SkillLevel"
        WHEN 'INTERMEDIATE' THEN 'LOW_INTERMEDIATE'::"SkillLevel"
        WHEN 'ADVANCED' THEN 'HIGH_INTERMEDIATE'::"SkillLevel"
    END
);

ALTER TABLE "Player"
ALTER COLUMN "skillLevel" SET DEFAULT 'LOW_INTERMEDIATE';

DROP TYPE "SkillLevel_old";
