# 20260804000200 task source snapshot constraint rollback

This migration aligns the `task_instances_source_snapshot_check` database constraint with the
V1 task sources already defined by the Prisma schema and API.

Before rolling back, verify that no `MATERIAL`, `APPLICATION`, or `ISSUE` task instances remain.
Those rows are valid after this migration but are rejected by the previous constraint.

```sql
ALTER TABLE "task_instances"
  DROP CONSTRAINT "task_instances_source_snapshot_check";

ALTER TABLE "task_instances"
  ADD CONSTRAINT "task_instances_source_snapshot_check" CHECK (
    (
      "source_type" = 'SOP'
      AND "task_template_id" IS NOT NULL
      AND "completion_window_hours_snapshot" IS NOT NULL
    )
    OR (
      "source_type" = 'MANUAL'
      AND "task_template_id" IS NULL
      AND "completion_window_hours_snapshot" IS NULL
    )
  );
```
