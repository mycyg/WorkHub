-- Custom SQL migration file, put your code below! --
-- db-repos-7: listAuditLogsForWorkItem 的补充分支按
-- detail_json->>'work_item_id' 匹配 approval_request/agent_run 审计行（见
-- packages/db/src/repositories/audit.ts:listAuditLogsForWorkItem）。这条谓词此前没有任何
-- 索引支撑，工作项审计时间线一读就是全表扫描，且随 audit_logs（只增不删的流水表）增长线性变慢。
-- 表达式索引只覆盖非空值（多数 audit_logs 行的 detail_json 里根本没有 work_item_id 键），
-- 保持索引小且只服务这一条查询路径。
CREATE INDEX IF NOT EXISTS "audit_logs_detail_work_item_id_idx"
  ON "audit_logs" ((("detail_json" ->> 'work_item_id')))
  WHERE "detail_json" ->> 'work_item_id' IS NOT NULL;
