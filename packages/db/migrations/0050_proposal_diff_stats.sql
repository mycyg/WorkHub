-- R13 批 P1.5（右栏变动文件区）：proposals.diff_stats_json —— agent-runner 在 workdir 仍存活时
-- 顺手把 estimateDeliverableDiffStats 算出的聚合 + per-file 增删明细持久化，供右栏"变动文件"区
-- 随时点开随时看（workdir 是 ephemeral sandbox 路径，run 结束后大概率被清理，不能在渲染时现读）。
-- 单纯 ADD COLUMN、可空列，不需要 NOT VALID/VALIDATE 两段式：历史行/未跑过统计的行留 null，
-- 读侧诚实展示"改动详情不可用"而不是冒充 0（不写一次性回填脚本——回填需要读早已被清理的
-- workdir，本来就做不到）。
ALTER TABLE "proposals" ADD COLUMN IF NOT EXISTS "diff_stats_json" jsonb;
