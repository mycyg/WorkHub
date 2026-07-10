-- Real intake can leave durable system notices such as clarification_file_context_notice.
-- The old varchar(32) width rejected that 33-character kind in Postgres before
-- the clarification session could render.
ALTER TABLE "chat_messages" ALTER COLUMN "kind" TYPE varchar(64);
