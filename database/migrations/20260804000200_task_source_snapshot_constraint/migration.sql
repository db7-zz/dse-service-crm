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
      "source_type" IN ('MANUAL', 'MATERIAL', 'APPLICATION', 'ISSUE')
      AND "task_template_id" IS NULL
      AND "completion_window_hours_snapshot" IS NULL
    )
  );
