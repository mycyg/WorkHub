-- Custom SQL migration file, put your code below! --
-- B4: crashed runs (OOM/segfault while status='running') leave an expired lease; requeueExpiredClaims
-- resets them to 'queued' and the recovery tick re-runs them — with no attempt cap a poison run loops
-- forever, burning worker capacity and budget. Track recover attempts so a run that keeps crashing is
-- dead-lettered (status='failed') instead of requeued indefinitely. Backfills existing rows to 0.
ALTER TABLE "agent_runs" ADD COLUMN "recover_attempts" integer DEFAULT 0 NOT NULL;
