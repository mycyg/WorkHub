-- rank1（R8 深复审）：项目 slug 唯一性应「按工作区」而非全局。
-- bootstrapPilotProject 的 create-or-reuse 按 slug 命中，旧全局唯一索引 projects_slug_uq(slug) 下，
-- B 工作区里创建一个与 A 工作区同 slug 的项目会命中并返回 A 的项目（created=false），跨租户串号/泄漏；
-- 且非原子 SELECT→INSERT 在并发同 slug 时第二发会撞全局唯一抛 500。改为 (workspace_id, slug) 唯一，
-- 与 workspaces_org_slug_uq 同范式。迁移前全局唯一 ⇒ 不存在两行同 slug，故新约束严格更宽松、无冲突回填。
-- IF EXISTS / IF NOT EXISTS 幂等；手写 SQL（snapshot 链止于 0015）。
DROP INDEX IF EXISTS "projects_slug_uq";
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "projects_slug_uq" ON "projects" ("workspace_id","slug");
