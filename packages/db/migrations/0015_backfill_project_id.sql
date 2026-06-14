-- Custom SQL migration file, put your code below! --
-- P-COLLAB: backfill project_id on legacy accepted_deliverable_changes rows so the
-- project-scope conflict detection (inc2) sees pre-existing accepted changes on upgrade.
-- Fresh databases have no legacy rows (no-op there); existing deployments get every
-- historical row stamped with its work item's project, closing the lost-update gap for
-- files last accepted before the project_id column existed.
UPDATE "accepted_deliverable_changes" AS adc
SET "project_id" = wi."project_id"
FROM "work_items" AS wi
WHERE adc."work_item_id" = wi."id"
  AND adc."project_id" IS NULL;
