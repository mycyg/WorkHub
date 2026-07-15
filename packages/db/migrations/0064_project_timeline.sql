-- R15 批 E1（项目时间线 / 甘特底座）：给「排期 · 里程碑 · 依赖」补齐数据模型。additive-only：
-- 两张新表 + work_items 加一列 milestone_id，绝不改既有列/约束。CREATE TABLE / ADD COLUMN / CREATE INDEX
-- 全部 IF NOT EXISTS，保证 migration-audit 的 replay 阶段（>=0031 的文件整链重跑一次）幂等安全。
--
-- project_milestones：项目内的里程碑（甘特上的菱形节点）。due_at 可空——里程碑可先建后定期。sort 排项目内
-- 顺序，status 只有 open/done（CHECK 钉死）。软删走 deleted_at（读侧一律过滤，历史留痕不物理删）。
CREATE TABLE IF NOT EXISTS "project_milestones" (
  "id" uuid PRIMARY KEY NOT NULL,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "title" varchar(256) NOT NULL,
  "due_at" timestamp with time zone,
  "sort" integer NOT NULL DEFAULT 0,
  "status" varchar(16) NOT NULL DEFAULT 'open',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "deleted_at" timestamp with time zone,
  CONSTRAINT "project_milestones_status_ck" CHECK ("status" IN ('open','done'))
);
--> statement-breakpoint
-- work_item_dependencies：人类排期意义上的「A 依赖 B」有向边（B 阻塞 A）。task_plan_items.dependsOn 是
-- agent 任务 DAG，跟这个是两码事。复合唯一杜绝重复边，CHECK 禁自依赖；同项目 + 环检测在仓库层强制
-- （MVP 记录在案的取舍：跨项目依赖不允许，环检测在插入前 BFS，见 repositories/project-timeline.ts）。
CREATE TABLE IF NOT EXISTS "work_item_dependencies" (
  "id" uuid PRIMARY KEY NOT NULL,
  "work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "depends_on_work_item_id" uuid NOT NULL REFERENCES "work_items"("id") ON DELETE cascade,
  "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE set null,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "work_item_dependencies_no_self_ck" CHECK ("work_item_id" <> "depends_on_work_item_id")
);
--> statement-breakpoint
-- 里程碑读排序（项目内 sort）与时间线取数（项目内按到期）各一条索引。
CREATE INDEX IF NOT EXISTS "project_milestones_project_sort_idx" ON "project_milestones" ("project_id","sort");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_milestones_project_due_idx" ON "project_milestones" ("project_id","due_at");
--> statement-breakpoint
-- 复合唯一：一条 (依赖方, 被依赖方) 边至多一次（幂等增边）；前导列 work_item_id 也服务正向邻居查询。
CREATE UNIQUE INDEX IF NOT EXISTS "work_item_dependencies_pair_uq" ON "work_item_dependencies" ("work_item_id","depends_on_work_item_id");
--> statement-breakpoint
-- 反向索引：算「这件卡在你这里，后面 N 件在等」（阻塞闭包）要按 depends_on_work_item_id 反查邻居。
CREATE INDEX IF NOT EXISTS "work_item_dependencies_depends_on_idx" ON "work_item_dependencies" ("depends_on_work_item_id");
--> statement-breakpoint
-- work_items 挂里程碑：可空外键，里程碑软删/删项目时置空（SET NULL，不连带删工作项）。同项目校验在仓库层。
ALTER TABLE "work_items" ADD COLUMN IF NOT EXISTS "milestone_id" uuid REFERENCES "project_milestones"("id") ON DELETE set null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "work_items_milestone_id_idx" ON "work_items" ("milestone_id");
