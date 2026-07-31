CREATE UNIQUE INDEX "sop_versions_only_one_draft_idx"
ON "sop_versions" ("status")
WHERE "status" = 'DRAFT';
