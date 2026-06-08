---
component: F10
title: 审计 + 快照 / 回滚（Audit + Snapshot / Rollback）系统级实现 plan
status: draft
depends: [F2, F3, F8]
date: 2026-06-05
master: ../2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: ./_migration-inventory.md
specs:
  - ../../workhub/02-ai-engine/agent-loop-and-tools.md
  - ../../workhub/01-architecture/data-model.md
  - ./_experience-deliverable-contracts.md
  - ./_ts-first-module-port-page-alignment.md
---

# F10 · 审计 + 快照 / 回滚 —— 系统级实现 plan

> 本组件是 P0 地基的**安全宪法承载层**：把现有零散的两套审计/undo 原语（`ActivityLog` + `ProjectDriveOperation.undone_at`）统一为 `AuditLog`，**新增通用 `Snapshot` 实体 + revert 契约**，并落地 Master §6 第 6 条红线——**「AI 任何副作用先有同事务 `Snapshot`，快照失败则拒绝执行；不可逆写须 ask-gate」**。
> **TS-first 修正**:新仓实现默认落 `packages/audit` 的 transaction wrapper 与 manifest facts helper;旧 Python/SQLAlchemy 代码只作行为锚点。
>
> 现状根：`app/models.py:554`(`ActivityLog`)、`app/models.py:214`(`ProjectDriveOperation`)、`app/routers/project_drive.py:1504`(undo 处理器)、`app/services/activity.py:12`(`log_activity`)、`app/services/lifecycle.py:104/164`(queue-in-tx/flush-post-commit)。
> 规格根：`data-model.md §7.5`(`Snapshot`)、`§8.3`(`AuditLog`)、`agent-loop-and-tools.md §7`(每步快照与回滚)、`§2.2 ④`(副作用前打快照)。
> 红线开放问题:`agent-loop-and-tools.md §10.5`(哪些业务写不可逆、须前置 ask)——本 plan 在「数据与接口契约」给出 P0 判定清单。

---

## 目标

1. **统一审计**：把 `ActivityLog`(WorkItem 级)与 `ProjectDriveOperation`(drive 级 undo)收敛为单一 `AuditLog`,带 `actor_kind`(human/ai/system)、`before/after` 引用、`snapshot_id`、`undone_at`,**append-only、永不软删**(治理证据不可篡改,`data-model.md §8.3`)。
2. **新增通用快照**：`Snapshot` 实体 + 每个 AI 副作用执行前的快照(`agent-loop-and-tools.md §7.1`),覆盖**文件域**(沙箱 `workdir`)与**业务对象域**(WorkItem/Drive/结构化记录)。
3. **落地红线 fail-closed**：AI 任一副作用工具执行前必须成功打快照,**快照失败 ⇒ 拒绝执行该副作用**(`is_error` 回灌,不崩、不静默写)。快照与业务写**同一 PG 事务**(F3 提供 PG 事务语义)。
4. **revert 契约**：`revert(run, to=snapshot_id|step_index)` 还原文件域 + 倒序应用业务域反向补偿,**revert 本身也写 `AuditLog`**,幂等(`agent-loop-and-tools.md §7.2`)。
5. **不可逆写 ask-gate**：对 P0 判定为「天然不可逆」的业务写(已发外部通知等),执行前强制走 F6 的 `ask` 阻塞原语,解 `agent-loop-and-tools.md §10.5` / Master §9 风险 5。
6. **交付物变更申请事实源**：为 `DeliverableChangeManifest` 提供 `rollback.snapshot_id`、`checks.snapshot_exists/revert_available`、`risk.reversible`、`evidence_refs` 的审计/快照真相,避免 Proposal 说明只靠 AI 文案。

---

## 范围（Scope）

### In（P0 必须）

- `AuditLog` 实体(新表)+ `Snapshot` 实体(新表),Drizzle 首迁移随 F3 落地。
- `ActivityLog` / `ProjectDriveOperation` → `AuditLog` 的**数据迁移 + 写入面切换**(双写过渡期内统一到新表)。
- 通用 `SnapshotService`:`take(scope, ref, ...)` + `revert(to, ...)`,文件域(内容寻址 sha256/CoW 工作树)+ 业务域(before-image + 反向补偿)双载体。
- AgentLoop 接入点(F8 提供 hook):每步**首个 `side_effect=True` 工具执行前** `take` 快照(`agent-loop-and-tools.md §2.2 ④`);失败 ⇒ fail-closed。
- 「不可逆写清单」+ 执行前 ask-gate 判定函数(接 F6 `PermissionPolicy.effect=ask`)。
- 业务写经统一审计封装(`record_audit(...)` 取代散落的 `log_activity` / `_record_op`)。
- 把现有 drive undo(`project_drive.py:1504`)的逆操作语义,泛化为 `Snapshot` 业务域反向补偿的**首批参考实现**。
- `manifest_check_context(snapshot_id, audit_ids...)` 辅助函数:给 F8/F11 生成 `DeliverableChangeManifest.checks/risk/rollback` 使用;F10 不负责 UI,只提供事实切片。

### Out（明确推迟到 P1+）

- **已合并入 main 的改动回滚** → 走 Proposal 反向流程(`agent-loop-and-tools.md §7.2`),属 F-merge / P3 `branch-proposal-merge.md`。
- **增量/净变更快照优化**(大 `workdir` 下只快照净变更)——P0 先「只读步彻底跳过、写步全量」,优化留 P1(`agent-loop-and-tools.md §10.3`)。
- **跨 worker 文件域 CoW/git 快照后端选型固化**——P0 用内容寻址 sha256 复用现有 drive 版本范式;底层 git/CoW 引擎评估推迟 P1。
- **审计可视化/合规报表/保留-归档策略执行**——审计度量看板属 P4(Master §10);P0 仅保证 append-only 落库 + 可查。
- **多租户审计隔离的运行时强制**(`org_id`/`workspace_id` 列 P0 落库,按租户过滤的查询面随 F11/P5 完善)。
- **business 域反向补偿的「完备覆盖所有写类型」**——P0 覆盖 drive 操作 + WorkItem 状态/派活/结构化记录的可逆子集;不可逆子集一律 ask-gate,不强求逆操作。

---

## 现状 → 改动（按 PORT / REFACTOR / NEW 分组）

### PORT（逐字/范式移植,语义不变）

- **P-1 undo 范式 `undone_at`** ← `ProjectDriveOperation.undone_at`(`models.py:222`)。`AuditLog.undone_at` 与 `Snapshot.reverted_at` 沿用「打标记而非删行」的 undo 范式(`data-model.md §8.3/§7.5`)。
- **P-2 内容寻址 sha256 去重** ← `ProjectDriveVersion.sha256`(`models.py:204`)+ 交付包 `package_sha256`(`auto.py:207`)。`Snapshot.content_sha256` 复用,文件域快照内容寻址(`agent-loop-and-tools.md §7.1`)。
- **P-3 逆操作分派表** ← drive undo 处理器(`project_drive.py:1518-1571`,按 `op_type` 分派 create/replace/delete/restore/patch/paste_cut 的逆操作)。这是 `Snapshot` 业务域反向补偿的**首批参考实现**,迁移时把「单 actor、单项目」放宽为「按 `AuditLog` 倒序补偿」。
- **P-4 queue-in-transaction / publish-after-commit** ← `lifecycle.queue_status_notifications`(`lifecycle.py:104`,不 commit 不 publish)/ `flush_status_notifications`(`lifecycle.py:164`,commit 后才推、吞 bus 异常)。审计写入 + 快照引用必须**同事务**入库,事件(`step.snapshot`)commit 后才发(对齐 Master §6.7 通知不漏 + §6.6 红线同事务)。
- **P-5 `log_activity` 调用风格** ← `services/activity.py:12`(集中一处写审计行,`json.dumps(..., ensure_ascii=False)`)。泛化为 `record_audit(...)` 但保留「单一封装、统一序列化」纪律。
- **P-6 append-only drive 版本** ← `ProjectDriveVersion`(`models.py:192`,`version_no` 单调 + `UniqueConstraint(item_id, version_no)`)。`AuditLog` append-only + 不可改语义沿用。

### REFACTOR（已有但需改造）

- **R-1 `ActivityLog` → `AuditLog`**(`models.py:554`)。现 `ActivityLog` 仅 `requirement_id/actor_nickname/action/detail_json`,**只有 nickname 无 actor_kind、无 user_id、无快照引用**。泛化:加 `actor_kind`(human/ai/system)、`actor_user_id`(授权真相,`actor_nickname` 仅展示——对齐 `data-model.md §1.4` 身份双写)、`entity_type`/`entity_id`(从 `requirement_id` 专用 → 全实体)、`detail_json`→JSONB、`snapshot_id`、`undone_at`。`requirement_id` 专列退役为 `entity_type='work_item'` + `entity_id`。
- **R-2 `ProjectDriveOperation` → `AuditLog` 写入面**(`models.py:214`,`_record_op` @ `project_drive.py:417`)。drive 操作不再单写 `ProjectDriveOperation`,改写 `AuditLog`(`entity_type='drive_item'`,`detail_json` 含逆操作 payload)。**逆操作 payload 结构原样保留**(create/replace/delete/restore/patch/paste_cut 的 `old_state`/`old_parents`/`previous_version_id` 等),只换载体表。
- **R-3 `log_activity` 签名扩展**(`activity.py:12`)。`requirement_id=` 专参 → `entity_type=/entity_id=`;新增 `actor_kind=`、可选 `snapshot_id=`、`before=/after=`。旧 6 个调用点(`auto.py:96/215/245/342` 等)逐一改接,**AI 路径的 actor_kind 必须显式标 `ai`**(现 `auto.py:216` 用 `actor_nickname=f"AI (...)"` 字符串约定,易漏——改为结构化字段)。
- **R-4 drive undo 处理器**(`project_drive.py:1504`)。从「查 `ProjectDriveOperation`」改为「查 `AuditLog` 可逆行」+ 调 `SnapshotService.revert`;逆操作分派逻辑(`:1520-1571`)迁入 `SnapshotService` 业务域补偿器,API 端点保留兼容。
- **R-5 `datetime.utcnow()` → `timestamptz`**(`activity.py` 无 ts、`project_drive.py:418/1572` 用 naive `utcnow()`)。随 F3 时间审校,`AuditLog.created_at` / `undone_at` / `Snapshot.created_at` / `reverted_at` 一律 aware `timestamptz`(Master §6.2)。

### NEW（净新增,无现成对应）

- **N-1 `Snapshot` 实体**(`data-model.md §7.5`):`work_item_id/branch_id/kind(pre_step|merge|manual)/ref/content_sha256/created_by_kind/reverted_at`。**现状无通用快照,仅 drive `undone_at` 一处专用 undo**——这是净新设计(inventory §9 RISK)。
- **N-2 `SnapshotService`**:`take(scope, ...)`(文件域:工作树内容寻址快照;业务域:before-image 镜像 + 反向补偿描述)+ `revert(to)`(文件域还原 + 业务域倒序补偿)+ 幂等守卫(版本号/已 reverted 检查)。
- **N-3 fail-closed 红线闸门**:`require_snapshot_before_side_effect(ctx)` ——AgentLoop 在执行 `side_effect=True` 工具前调用;快照 `take` 抛错 ⇒ 不执行工具,构造 `is_error` 的 `ToolResult` 回灌(`agent-loop-and-tools.md §2.4`),`AgentRun` 不崩。
- **N-4 不可逆写判定 + ask-gate**:`is_irreversible(action, target) -> bool` + 命中则前置 `request_approval`(接 F6 `ApprovalRequest`,`agent-loop-and-tools.md §2.5`)。解 §10.5 开放问题——P0 判定清单见下「数据与接口契约」。
- **N-5 `AgentStep.snapshot_id` 回填**(`data-model.md §7.2`):每步副作用前快照 id 写入 step 行(只读步为 NULL),供 trace 可审 + 单步 revert。F8 持久化 `AgentStep`,F10 提供 snapshot id。
- **N-6 manifest facts**:`build_manifest_facts(run_id|proposal_id)` 输出 `{snapshot_exists,revert_available,rollback_snapshot_id,reversible,evidence_refs,check_results}`,供 F8 的 `DeliverableChangeManifest` 草案和 F11 的 Proposal 详情复用。

---

## 实施步骤（有序可勾选）

> 前置:F2(实体框架)、F3(PG + Drizzle migration + timestamptz/JSONB)、F8(AgentLoop + ToolRegistry + `side_effect` 标记 + ctx)已就绪。

- [ ] **1. 建模 `AuditLog` + `Snapshot`**(依赖 F2/F3)
  - [ ] 1.1 在 `app/models.py` 新增 `AuditLog`(字段见契约表),JSONB `detail_json`,`created_at` 索引,append-only(无 `deleted_at`)。
  - [ ] 1.2 新增 `Snapshot`(字段见契约表),`ref`/`content_sha256`/`reverted_at`。
  - [ ] 1.3 `AgentStep` 加 `snapshot_id` FK(与 F8 协调,二者同迁移)。
  - [ ] 1.4 Drizzle 迁移脚本:建两表 + 索引(`entity_type`/`entity_id`/`created_at`/`snapshot_id`);up/down 可逆测试(Master §10)。
- [ ] **2. `SnapshotService` 核心**(NEW)
  - [ ] 2.1 文件域 `take`:对 `workdir` 内容寻址快照(复用 drive sha256 范式 P-2),写 `Snapshot(kind='pre_step', ref=..., content_sha256=...)`。
  - [ ] 2.2 业务域 `take`:写操作前抓 before-image,落 `AuditLog.detail_json.before` + 反向补偿描述。
  - [ ] 2.3 `revert(to)`:文件域还原 + 业务域**倒序**应用 `AuditLog` 反向补偿,写 revert 审计行,幂等守卫(已 `reverted_at` 跳过)。
  - [ ] 2.4 与业务写**同一 `db` 事务**(不自 commit;调用方控制),对齐 P-4。
- [ ] **3. 统一审计写入面**(REFACTOR R-1/R-2/R-3/R-5)
  - [ ] 3.1 实现 `record_audit(db, *, actor_kind, actor_user_id, actor_nickname, entity_type, entity_id, action, before=None, after=None, snapshot_id=None)`。
  - [ ] 3.2 改 `services/activity.py:log_activity` → 转调 `record_audit`(保留旧签名薄封装,逐步替换);6 个旧调用点(`auto.py:96/215/245/342`…)显式补 `actor_kind`。
  - [ ] 3.3 `_record_op`(`project_drive.py:417`)→ `record_audit(entity_type='drive_item', ...)`,逆操作 payload 入 `detail_json`。
- [ ] **4. 红线闸门接入 AgentLoop**(NEW N-3,依赖 F8)
  - [ ] 4.1 在 F8 的「执行 `side_effect` 工具前」hook(`agent-loop-and-tools.md §2.2 ④`)调 `SnapshotService.take`;成功才执行工具。
  - [ ] 4.2 `take` 抛错 ⇒ 跳过工具,`ToolResult(is_error=True, content="[error] 快照失败,已拒绝该改动")` 回灌;**绝不静默写、绝不崩**。
  - [ ] 4.3 快照 id 回填 `AgentStep.snapshot_id`(N-5);发 `run:<id>` `step.snapshot` 事件(commit 后,P-4)。
- [ ] **5. 不可逆写 ask-gate**(NEW N-4,依赖 F6)
  - [ ] 5.1 实现 `is_irreversible(action, target)`(查 P0 判定清单)。
  - [ ] 5.2 命中 ⇒ 执行前 `request_approval`(F6 阻塞原语);拒绝 ⇒ `is_error` 理由回灌,不写。
  - [ ] 5.3 `AuditLog` 记录该写为 `action` + `detail_json.gate='ask'` + 审批结果。
- [ ] **6. manifest facts 输出**(NEW N-6,供 F8/F11)
  - [ ] 6.1 `build_manifest_facts(run_id|proposal_id)` 汇总 `Snapshot`/`AuditLog`/不可逆判定结果。
  - [ ] 6.2 输出 checks:`snapshot_exists`、`artifact_exists`(F8 传入)、`evidence_linked`、`revert_available` 或 `ask_gate_required`。
  - [ ] 6.3 输出 `rollback.available/snapshot_id/description` 与 `risk.reversible/irreversible_reasons`。
- [ ] **7. drive undo 端点改接**(REFACTOR R-4)
  - [ ] 7.1 `undo_drive_operation`(`project_drive.py:1504`)改查 `AuditLog` 可逆行 + 调 `SnapshotService.revert`。
  - [ ] 7.2 逆操作分派(`:1520-1571`)迁入 `SnapshotService` 业务补偿器;端点行为/响应保持兼容。
- [ ] **8. 数据迁移**(REFACTOR R-1/R-2)
  - [ ] 8.1 Drizzle migration 数据迁移:`activity_log` 行 → `audit_log`(`entity_type='work_item'`,`actor_kind` 从 nickname 启发式推断 AI 行,无法判定标 `human`)。
  - [ ] 8.2 `project_drive_operations` 行 → `audit_log`(`entity_type='drive_item'`,`undone_at` 直迁,payload 入 `detail_json`)。
  - [ ] 8.3 旧表保留只读一个 release(回滚安全),新写全走 `audit_log`。
- [ ] **9. 验收测试**(见下「验收用例」)
  - [ ] 9.1 快照失败 ⇒ 副作用被拒(red-line 集成测试,对齐 Master §7 场景④)。
  - [ ] 9.2 AI 写业务对象 → 快照存在 → revert 还原(Master §8 / §7 场景④)。
  - [ ] 9.3 不可逆写 → 命中 ask-gate(阻塞 + 拒绝回灌)。
  - [ ] 9.4 审计 append-only:revert 不删原行,新增 revert 审计行。
  - [ ] 9.5 同事务原子:业务写回滚则快照行也回滚(无孤儿快照)。
  - [ ] 9.6 manifest facts:给定一次 AI 产物 run,输出 `snapshot_exists/revert_available/rollback_snapshot_id/risk.reversible` 与 manifest 契约一致。

---

## 数据与接口契约

> 跨组件共享处以 Master + 规格为准;字段权威定义在 `data-model.md §7.5/§8.3`,本节给 F10 落地切片。

### 实体:`AuditLog`(`data-model.md §8.3`)

| 字段 | 类型(PG) | 说明 |
|---|---|---|
| `id` | UUID PK | 应用层生成(`uid()` 范式,`models.py:12`) |
| `org_id` / `workspace_id` | UUID FK?, index | 租户作用域(P0 默认单租户回填,查询面隔离随 F11) |
| `actor_kind` | str(16) | `human` / `ai` / `system`(**REFACTOR R-3 关键新增**,取代字符串 nickname 约定) |
| `actor_user_id` | UUID FK?, index | 授权真相;`actor_nickname` 冗余展示(身份双写 `§1.4`) |
| `entity_type` | str(64), index | `work_item` / `proposal` / `drive_item` / `branch`…(泛化自 `requirement_id` 专列) |
| `entity_id` | str(64), index | 被作用实体 id |
| `action` | str(64), index | `status_change` / `merge` / `write_file` / `approve` / `revert`… |
| `detail_json` | JSONB | `{before, after, gate?, inverse_op?}`(JSON→JSONB,R-1) |
| `snapshot_id` | UUID FK→snapshots.id?, index | 关联回滚点(N-1) |
| `undone_at` | timestamptz? | 已回滚标记(undo 范式 P-1) |
| `created_at` | timestamptz, index | append-only,不可改;**无 `deleted_at`**(治理证据不软删) |

### 实体:`Snapshot`(`data-model.md §7.5`)

| 字段 | 类型(PG) | 说明 |
|---|---|---|
| `id` | UUID PK | |
| `work_item_id` | UUID FK→work_items.id, CASCADE, index | |
| `branch_id` | UUID FK→branches.id?, index | |
| `kind` | str(16) | `pre_step`(步前,默认)/ `merge` / `manual` |
| `ref` | str(128) | 底层快照引用(content-store ref / 未来 git hash) |
| `content_sha256` | str(64)? | 内容寻址校验(P-2) |
| `created_by_kind` | str(16) | `ai` / `human` / `system` |
| `reverted_at` | timestamptz? | 已回滚标记(沿用 `ProjectDriveOperation.undone_at` 范式 P-1) |
| `created_at` | timestamptz | |

### Drizzle migration

- 随 F3 首迁移族:`create_table('audit_log')` + `create_table('snapshots')` + `audit_log` 索引(`entity_type,entity_id`/`created_at`/`snapshot_id`);`agent_steps.snapshot_id` FK(与 F8 协调列序)。
- 数据迁移 op:`activity_log`→`audit_log`、`project_drive_operations`→`audit_log`(步骤 7)。
- up/down 可逆(Master §10 CI 迁移校验);down 还原旧表写入面。

### API（最小,详尽路由分组在 F11）

> 路径前缀/命名以 [`api-contract.md`](../../workhub/01-architecture/api-contract.md) §1/§2 为唯一真相:`/api` 前缀、工作项路径用复数 `workitems`、agent-run 用 `agent-runs`。F10 仅定义其新增端点的形状,挂载/OpenAPI 暴露归 F11。

- `POST /api/agent-runs/{run_id}/revert` —— body `{to: snapshot_id | step_index}`;权限经 F6;返回还原后状态 + 新 revert 审计行 id。(`agent-loop-and-tools.md §7.2`;挂在 api-contract §2.6 agent-run 组,与 `POST /api/agent-runs/{id}/abort` 同族)
- `POST /api/projects/{project_id}/drive/undo` —— **兼容保留**(R-4,沿用现有 `routers/project_drive.py:1504` 路径),内部转 `SnapshotService.revert`。
- `GET /api/workitems/{id}/audit` —— append-only 审计流(P0 最小读端点,按身份/租户过滤;归 api-contract §2.12 comments/activity 演进面)。

### 事件 topic（taxonomy 供 F5,Master §6.8）

- `run:<run_id>` · `step.snapshot` `{index, snapshot_id}` —— 打了快照(`agent-loop-and-tools.md §6.2`;与 F8 同源 trace 事件)。
- `permission.ask` —— 不可逆写命中 ask-gate 时的客户端事件,**复用 F6 的审批阻塞事件,不另立事件名**;topic 与 payload 以 [`api-contract.md`](../../workhub/01-architecture/api-contract.md) §5.2 为唯一真相(`session:{id}` + 被路由审批人 `user:{id}`,payload `{approval_id, tool, summary, ttl}`)。F10 仅是其触发源之一(N-4),事件由 F6 阻塞原语统一发出。
- **截断纪律**:事件载荷只放预览/引用,完整 before/after 落 `AuditLog.detail_json`(对齐 §6.2 截断纪律)。
- **隐私门**:`run:<id>` 仅该 run owner/审批人可订阅(NFR-08,Master §6.5;订阅边界重强制 `can_view`)。

### P0 「不可逆写」判定清单（解 `agent-loop-and-tools.md §10.5` / Master §9 风险 5）

> MVP 原则(Master §9.5):**先覆盖可逆写,不可逆写一律 ask**。下表是 P0 判定基线。

| 业务写 | 可逆性 | P0 处置 |
|---|---|---|
| 沙箱 `workdir` 文件写(write/move/delete/zip/run_command) | 可逆(快照还原) | take 快照后执行;失败拒绝 |
| WorkItem 状态变更(CAS) | 可逆(before-image 反写) | 快照 + 审计;无须 ask |
| 派活写(`Assignment` 行) | 可逆(逆操作删/改行) | 快照 + 审计;无须 ask |
| Drive item create/replace/delete/patch/move | 可逆(现有逆操作 P-3) | 快照 + 审计;无须 ask |
| 结构化记录(Proposal/Review 草稿) | 可逆(软删/版本回退) | 快照 + 审计 |
| **已发外部通知 / SSE 推送给用户** | **不可逆** | **执行前 ask-gate**(N-4) |
| **已落库的对外交付包发布** | **不可逆**(他人已见) | **ask-gate** |
| **触发第三方副作用的 `run_command`**(网络出口未拦,`auto_agent.py:276`) | **不可逆** | **ask-gate**(并标 `detail_json.risk='external'`) |

### Manifest facts 契约

F10 为 `_experience-deliverable-contracts.md` §3 的 `DeliverableChangeManifest` 提供事实字段,不生成完整 UI 文案:

| manifest 字段 | F10 来源 |
|---|---|
| `base.snapshot_id` | AgentRun 起始或 step 前 `Snapshot.id` |
| `rollback.available` | `Snapshot.reverted_at IS NULL` 且存在已实现补偿器 |
| `rollback.snapshot_id` | 可回滚的最近安全 snapshot |
| `risk.reversible` | `is_irreversible(action,target)` 的反值 + 补偿器可用性 |
| `risk.irreversible_reasons` | 外部通知/对外交付/网络副作用等判定原因 |
| `checks.snapshot_exists` | side-effect 前成功写入 `Snapshot` |
| `checks.revert_available` | `SnapshotService.revert` dry-run / 补偿器存在 |
| `evidence_refs` | `AuditLog` / `AgentStep` / `Snapshot` refs |

---

## 验收用例（可测）

1. **红线 fail-closed（核心)**:mock `SnapshotService.take` 抛错 → AI `write_file` 工具**不执行**(文件未落盘),`ToolResult.is_error=True`,`AgentRun` 不崩、继续循环 → 断言「快照失败 ⇒ 副作用被拒」(Master §8 「快照失败则副作用被拒」、§7 场景④)。
2. **快照存在 + revert 还原**:AI 跑一步写 3 个文件 + 改 WorkItem 状态 → 断言 `Snapshot` 行存在、`AgentStep.snapshot_id` 非空 → `revert(to=step_index)` → 文件还原 + 状态回退 + 新增 `action='revert'` 审计行(Master §8 「revert 可还原」)。
3. **同事务原子**:业务写在 commit 前抛异常回滚 → 断言对应 `Snapshot`/`AuditLog` 行**也不存在**(无孤儿快照,对齐 inventory §9 「快照与业务写同一 PG 事务」)。
4. **不可逆写 ask-gate**:AI 触发「已发外部通知」类写 → 断言进入 `awaiting_approval`(`AgentRun.status`,agent-loop §3.4)、发 `permission.ask`(api-contract §5.2)、拒绝 → `is_error` 理由回灌、写未发生(解 §10.5)。
5. **审计 append-only**:revert 后断言原审计行**未被删除**(`undone_at` 打标),新增 revert 行;尝试 update 旧行被拒(无软删、不可改语义)。
6. **drive undo 兼容回归**:对现有 6 类 `op_type`(create/replace/delete/restore/patch/paste_cut)各跑「操作→undo」→ 断言行为与现状(`project_drive.py:1520-1571`)逐一等价(R-4 不回归)。
7. **幂等 revert**:对同一 `snapshot_id` 连续 revert 两次 → 第二次 no-op,无副作用(`agent-loop-and-tools.md §7.2` 幂等)。
8. **actor_kind 正确**:AI 路径写审计 → `actor_kind='ai'`(非靠 nickname 字符串猜),人路径 `actor_kind='human'`(R-3)。
9. **manifest facts**:一次包含文件写 + WorkItem 状态变更的 run,`build_manifest_facts` 返回 `snapshot_exists=passed`、`revert_available=passed`、`rollback.snapshot_id` 非空;一次 external run_command 返回 `risk.reversible=false` 且 `ask_gate_required=warning|passed`。

---

## 回滚与风险

**回滚策略**
- 数据迁移期**双表并存一个 release**(步骤 7.3):新写走 `audit_log`,旧 `activity_log`/`project_drive_operations` 保留只读;若 `audit_log` 写入面出问题,可临时切回旧 `_record_op`/`log_activity`(薄封装 R-3.2 保留旧签名,便于一行切换)。
- Drizzle down migration 还原两新表 + 旧写入面(up/down 可逆测试覆盖)。
- 红线闸门(N-3)用 feature flag 包裹仅限开发排障:非生产可临时把 side-effect 工具整体禁用或只跑只读工具;**不得**把「快照失败」降级为允许写入。生产门(`main.py:227` 范式)下强制 fail-closed,不可降级。

**风险**
1. **通用业务对象逆操作是净新设计**(inventory §9 RISK、Master §5 F10 行)。异构写(状态/派活/结构化记录)的逆操作完备性不足 ⇒ revert 还原不全。**缓解**:P0 只承诺「可逆子集」revert 完备,不可逆子集走 ask-gate(不强求逆操作);drive 逆操作 P-3 已验证可作模板。
2. **快照与业务写未同事务 ⇒ 孤儿快照或「写成功快照失败」**。**缓解**:`SnapshotService` 不自 commit,强制随业务 `db` 事务(P-4);验收用例 3 守护。
3. **不可逆写判定漏判 ⇒ AI 静默做了不可回滚的事**。**缓解**:P0 清单**保守从严**(拿不准即归不可逆 → ask);`run_command` 因网络出口未拦(`auto_agent.py:276`)一律标 external + ask。
4. **审计写入面切换漏改某调用点 ⇒ 审计断流**(类比 F7 「漏一处静默绕过治理」)。**缓解**:grep `log_activity`/`_record_op` 全调用点逐一改接 + CI 断言无裸 `ActivityLog(`/`ProjectDriveOperation(` 实例化(除迁移期薄封装)。
5. **多 worker 下 revert 与并发写竞态**(F8 行锁/乐观锁前提)。**缓解**:revert 走 `SELECT … FOR UPDATE` 锁 WorkItem + main branch 头(`data-model.md §9.4`);快照 `reverted_at` 幂等守卫防双 revert。
6. **`actor_kind` 从旧 nickname 启发式推断不准**(迁移 7.1)。**缓解**:无法判定标 `human`(保守),不污染「AI 副作用」审计语义;新写一律结构化标注,不再靠字符串。

---

## 依赖与被依赖

**依赖(上游)**
- **F2 实体模型**:`AuditLog`/`Snapshot` 是 F2 新增实体清单的一部分;`WorkItem`/`Branch`/`AgentStep` FK 目标须就位。
- **F3 PostgreSQL + Drizzle migration**:提供 PG 事务(同事务快照+写的硬前提)、JSONB(`detail_json`)、timestamptz(R-5)、行级锁(revert 串行化)、Drizzle 迁移体系。F10 无 F3 不成立。
- **F8 Agent 引擎核心**:提供 AgentLoop 的「副作用前」hook(`§2.2 ④`)、`ToolSpec.side_effect` 标记、执行 ctx、`AgentStep` 持久化(回填 `snapshot_id`)。红线闸门(N-3)挂在 F8 循环上。
- **F6 权限引擎**(ask-gate 软依赖):N-4 不可逆写 ask 复用 F6 `ApprovalRequest` 阻塞原语 + 审批路由;F6 未就位时 ask-gate 可临时退化为「硬拒绝不可逆写」。
- **F5 事件 broker**(事件软依赖):`step.snapshot`/`permission.ask` 经 F5 跨 worker 扇出 + 订阅边界鉴权(NFR-08)。

**被依赖(下游)**
- **F8**:红线本身 gate 了 AI 副作用——F8 的「每步快照」交付项落在 F10(`agent-loop-and-tools.md §7` 由 F10 实现实体与服务)。F8/F10 在 Master §5.1 依赖图中是 F8 后并行的 `{F9,F10}`,但红线接入使二者强耦合,需协同集成测试(Master §7 场景④)。
- **F9 生命周期/通知**:状态变更审计(`action='status_change'`)与 F9 的 `_MILESTONES` 通知共享 queue-in-tx/flush-post-commit 范式(P-4);新状态(`escalated/pm_mode/in_review/merged`)的审计行由 F10 落,通知由 F9 发。
- **F11 daemon 拆分 / 客户端**:审计/revert API(`GET /api/workitems/{id}/audit`、`POST /api/agent-runs/{run_id}/revert`)随 F11 OpenAPI-first 暴露;drive undo 端点兼容由 F11 客户端消费。
- **P3 branch-proposal-merge**:已合并改动的回滚走 Proposal 反向流程,以 F10 的 `Snapshot.merge` 快照(`merge_snapshot_id`)为锚点(Out,但 P0 预留字段)。

---

## Target TS paths

> 本组件施工时,旧 `ActivityLog`、drive undo 与 operation log 是 behavior source;新实现落审计/快照 package 与 DB schema。

| 类别 | 目标路径 | 必须产物 | 审计门禁 |
|---|---|---|---|
| audit package | `packages/audit/src/*` | `AuditLogService`, `SnapshotService`, revert helpers | 快照失败 fail-closed |
| DB schema | `packages/db/src/schema/audit.ts`, `packages/db/src/repositories/audit.ts` | `audit_logs`, `snapshots`, snapshot refs | 同事务写入 |
| contracts | `packages/contracts/src/audit.ts`, `packages/contracts/src/replay.ts` | `AuditLogVM`, `SnapshotRef`, `ReplayTraceVM` facts | raw log 默认脱敏 |
| API/page | `apps/api/src/routes/audit.ts`, `apps/api/src/pages/replay.ts` | audit/revert/replay endpoints | revert 行锁/幂等 |

**PR 必答**:列出 side-effect 工具的 `requires_snapshot` 策略;不可逆写若 F06 未就位必须硬拒绝,不得降级成仅告警。
