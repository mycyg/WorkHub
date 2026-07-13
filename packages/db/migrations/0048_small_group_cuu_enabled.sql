-- R13 批 G1（小群）：project_conversations 加会话级「Cuu 是否参与」硬开关。default true 保持
-- 所有既有会话（含存量 1:1 协同会话）的当前行为零回归；false 时 conversation-turns.ts 的 createTurn
-- 在任何回话判定（含未来 4c 的轻量判定器）之前直接拒绝，这是设计里明确的"强静默不可绕过"硬闸。
ALTER TABLE "project_conversations" ADD COLUMN IF NOT EXISTS "cuu_enabled" boolean NOT NULL DEFAULT true;
