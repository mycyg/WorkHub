-- R14 批 AVATAR（头像与资料入口，2026-07-14 用户点名新增）：users 加头像二进制列 + 更新时间戳。
-- 零对象存储、零图片处理依赖（开源自托管友好）——客户端 canvas 裁剪+降采样到 256x256 再上传，
-- 服务端只做 magic bytes 校验（webp/png/jpeg）+ 256KB 硬顶。两列均可空：历史用户行不受影响，
-- 没头像时渲染层回退既有首字母色块 tile。avatarUpdatedAt 兼作 GET /api/users/:id/avatar 的 ETag 源
-- （ETag = 该时间戳的毫秒值），支持 If-None-Match 304。
-- ADD COLUMN IF NOT EXISTS 保证重放安全（migration-audit 的 replay 阶段会整链重跑）。
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_webp" bytea;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "avatar_updated_at" timestamp with time zone;
