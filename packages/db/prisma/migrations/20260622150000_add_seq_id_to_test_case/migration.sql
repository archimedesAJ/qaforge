-- Step 1: add column as nullable
ALTER TABLE "TestCase" ADD COLUMN "seqId" INTEGER;

-- Step 2: backfill existing rows with sequential numbers ordered by creation date
WITH numbered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY "createdAt" ASC, id ASC) AS rn
  FROM "TestCase"
)
UPDATE "TestCase" t SET "seqId" = n.rn FROM numbered n WHERE t.id = n.id;

-- Step 3: create the sequence Prisma expects and advance it past the highest backfilled value
CREATE SEQUENCE "TestCase_seqId_seq";
SELECT setval('"TestCase_seqId_seq"', COALESCE((SELECT MAX("seqId") FROM "TestCase"), 0) + 1, false);

-- Step 4: make NOT NULL, attach sequence as default, add unique constraint
ALTER TABLE "TestCase" ALTER COLUMN "seqId" SET NOT NULL;
ALTER TABLE "TestCase" ALTER COLUMN "seqId" SET DEFAULT nextval('"TestCase_seqId_seq"');
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_seqId_key" UNIQUE ("seqId");
ALTER SEQUENCE "TestCase_seqId_seq" OWNED BY "TestCase"."seqId";
