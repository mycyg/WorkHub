-- Custom SQL migration file, put your code below! --
-- W2: approval-center "相关讨论" comment stream. New table modeled on project_drive_comments.
-- Cascade-deletes with its approval (self-cleaning); author FK restricts so authored history isn't orphaned.
CREATE TABLE IF NOT EXISTS "approval_comments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "approval_id" uuid NOT NULL REFERENCES "approval_requests" ("id") ON DELETE CASCADE,
  "author_user_id" uuid NOT NULL REFERENCES "users" ("id") ON DELETE RESTRICT,
  "author_nickname" varchar(64) NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "approval_comments_approval_created_idx" ON "approval_comments" ("approval_id", "created_at");
CREATE INDEX IF NOT EXISTS "approval_comments_author_user_id_idx" ON "approval_comments" ("author_user_id");
