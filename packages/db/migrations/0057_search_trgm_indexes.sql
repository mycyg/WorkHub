-- R14 批 SEARCH（全局搜索）：pg_trgm CJK 子串检索的扩展 + 五个 GIN 表达式/部分索引。
-- 零新部署依赖：pg_trgm 与 citext（见迁移 0023）同为官方 postgres 镜像自带 contrib，
-- migration-audit 的 replay 阶段整链重跑必过。手写 SQL（snapshot 链止于 0015，不跑 drizzle-kit
-- generate 以免污染 journal；schema.ts 刻意不声明这些 gin 索引以免 drizzle-kit 快照漂移，照 0023 先例）。
--
-- 排序=recency desc + ILIKE '%q%' 子串匹配（诚实二值 contains，非 similarity 阈值，见设计 §3）。
-- trgm GIN 只加速 ≥3 字符子串；1–2 字符（含最常见的 2 字 CJK 词）落 seqscan，靠逐 scope 围栏 join +
-- LIMIT 把成本压在已围栏的小行集上（自托管单实例小数据可接受，见设计 §3）。
--
-- migration-audit 硬门（scripts/dev/check-migrations.ts:224）：建索引语句必须带 IF NOT EXISTS
-- —— GIN 索引同走这条正则，故下面五个建索引语句全部带 IF NOT EXISTS（... USING gin ...）。
-- 不用并发建索引：drizzle migrator 单事务重放，并发建索引不能进事务；大库首建阻塞是已知取舍。
-- 表达式 immutability 已核查：jsonb ->> 是 jsonb_object_field_text（IMMUTABLE），coalesce/|| 均 IMMUTABLE，
-- 裸列 name/parsed_text 天然可入索引；部分谓词 kind='text' / deleted_at IS NULL 均 IMMUTABLE。
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

-- 会话消息正文：部分表达式索引，只覆盖真正可搜的 text 且未删除的行（其余 kind 的 content_json 无 'text' 键，
-- ->> 返回 NULL；墓碑 content_json 已清 {}）。查询 WHERE 用同一表达式 (content_json ->> 'text') ILIKE ...。
CREATE INDEX IF NOT EXISTS "conversation_messages_text_trgm_idx"
  ON "conversation_messages" USING gin ((content_json ->> 'text') gin_trgm_ops)
  WHERE kind = 'text' AND deleted_at IS NULL;--> statement-breakpoint

-- 工单：标题+描述合并表达式（coalesce/|| 均 IMMUTABLE），一条谓词一个索引覆盖两列；部分索引滤墓碑。
CREATE INDEX IF NOT EXISTS "work_items_search_trgm_idx"
  ON "work_items" USING gin ((coalesce(title,'') || ' ' || coalesce(raw_description,'')) gin_trgm_ops)
  WHERE deleted_at IS NULL;--> statement-breakpoint

-- 会议：标题+纪要合并表达式（无软删列，无部分谓词）。
CREATE INDEX IF NOT EXISTS "meeting_records_search_trgm_idx"
  ON "meeting_records" USING gin ((coalesce(title,'') || ' ' || coalesce(minutes_md,'')) gin_trgm_ops);--> statement-breakpoint

-- 网盘文件名：部分索引滤墓碑。
CREATE INDEX IF NOT EXISTS "project_drive_items_name_trgm_idx"
  ON "project_drive_items" USING gin (name gin_trgm_ops)
  WHERE deleted_at IS NULL;--> statement-breakpoint

-- 网盘正文：索引所有版本的 parsed_text（查询只 join 当前版；全版建索引简单且无害，内联 parsed_text ~64KB 上限）。
CREATE INDEX IF NOT EXISTS "project_drive_versions_parsed_text_trgm_idx"
  ON "project_drive_versions" USING gin (parsed_text gin_trgm_ops);
