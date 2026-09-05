-- R26 X（插件治理·阶段 2：让插件工具在真实部署里可用）：插件的信任级别 + 每插件熔断状态。
--
-- 修的裂缝：阶段 0/1 把插件工具一律钉成 external_effect，agent-runner 据此归到 external 风险类，
-- 人工保留门只要风险类非空就开升级并 409——等于**每次插件调用都转人**，插件面在真实部署里不可用。
-- 修法：给这张表一个管理员断言的风险上限 trust_level，与插件工具自述（宿主握手时报上来）取 AND，
-- 只有「管理员断言 read_only」且「工具自述只读」才落到低风险档。断言存在表上而不是算在应用层，
-- 是因为它是一次**人做出的授权决定**，必须可查、可审计、可回滚。
--
-- 同一批把熔断从「整个插件面」改成按插件：status 加 'crashed'，一个把宿主弄崩的插件只关自己，
-- 同工作区的其它插件照常工作；管理员在设置页看得到是哪一个、并可停用或修好后重新启用。
--
-- 全 additive：ADD COLUMN IF NOT EXISTS 带 NOT NULL DEFAULT（既有行全部落到最保守的 external_effect），
-- CHECK 用 DROP IF EXISTS + ADD 成对写法，migration-audit replay 整链重跑安全（同 0070/0071 约定）。
-- status 只放宽枚举（超集），既有行全部满足新约束。
ALTER TABLE "plugins" ADD COLUMN IF NOT EXISTS "trust_level" varchar(24) NOT NULL DEFAULT 'external_effect';
--> statement-breakpoint

ALTER TABLE "plugins" DROP CONSTRAINT IF EXISTS "plugins_trust_level_ck";
--> statement-breakpoint

ALTER TABLE "plugins" ADD CONSTRAINT "plugins_trust_level_ck"
  CHECK ("trust_level" IN ('read_only','external_effect'));
--> statement-breakpoint

ALTER TABLE "plugins" DROP CONSTRAINT IF EXISTS "plugins_status_ck";
--> statement-breakpoint

ALTER TABLE "plugins" ADD CONSTRAINT "plugins_status_ck"
  CHECK ("status" IN ('installed','load_failed','disabled','crashed'));
--> statement-breakpoint

-- 宿主装配热路径的部分索引要跟着走：熔断掉的插件不该再进任何一次握手的清单，
-- 否则它会一次次把宿主重新弄崩。旧索引只排除了 'disabled'。
DROP INDEX IF EXISTS "plugins_workspace_enabled_idx";
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "plugins_workspace_enabled_idx"
  ON "plugins" ("workspace_id")
  WHERE "enabled" = true AND "status" <> 'disabled' AND "status" <> 'crashed';
