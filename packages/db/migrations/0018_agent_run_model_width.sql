-- Custom SQL migration file, put your code below! --
-- L#61: agent_runs.model was varchar(64) while usage_records.model and cost_ledger_entries.model
-- are varchar(128). Widen it so a long provider model name can't be rejected/truncated on the run
-- row while it fits the cost ledger. Widening is lossless.
ALTER TABLE "agent_runs" ALTER COLUMN "model" TYPE varchar(128);
