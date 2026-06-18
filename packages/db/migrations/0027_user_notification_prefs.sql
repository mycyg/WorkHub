-- Custom SQL migration file, put your code below! --
-- 团队就绪 must-have（通知偏好-按类型静音）：每用户维护一份「被静音的通知类型」清单（jsonb 字符串数组）。
-- 空数组=不静音任何类型=既有行为逐字不变（DEFAULT-OFF 不变量）。通知创建路径在为收件人建通知前查此列，
-- 命中则跳过、不建。纯加列、默认空数组——既有行回填 '[]'、新行默认 '[]'，PG smoke（无静音偏好）字节不变。
-- 手写 SQL（snapshot 链止于 0015）。IF NOT EXISTS 幂等，与 0023 users offboard 列同一加列范式。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "muted_notification_types" jsonb NOT NULL DEFAULT '[]'::jsonb;
