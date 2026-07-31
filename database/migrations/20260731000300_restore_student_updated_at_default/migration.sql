-- Preserve the database-level default introduced with S1 student management.
-- Prisma still updates this column on application writes through @updatedAt.
ALTER TABLE "students"
  ALTER COLUMN "updated_at" SET DEFAULT CURRENT_TIMESTAMP;
