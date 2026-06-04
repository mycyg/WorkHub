---
module: 03-collaboration
layer: 协作层 (L3 · P-COLLAB)
status: 🚧
owner: workflow
---

# 双向同步与 README 规格（Sync & Spec-as-README）

> 本篇把 PRD §8.7（双向同步）+ §8.8（README=规格活文档）落到**接口/机制级**：同步协议的数据结构、状态流转、API/事件契约、合并算法与规则表、边界条件与失败处理。
> 上游：[PRD §8.7 / §8.8](../../prd/2026-06-04-workhub-prd.md) · [规格树索引](../README.md)。
> 兄弟篇：分支/提议/合并的对象合并语义、冲突 AI 调解的核心算法见 [`branch-proposal-merge.md`](./branch-proposal-merge.md)（本篇**复用其合并原语**，不重复）；审批阻塞原语、打回带理由回灌见 [`review-and-approval.md`](./review-and-approval.md)；进程边界、事件总线、同步是「桌宠↔daemon 数据流」的定位见 [`system-architecture.md`](../01-architecture/system-architecture.md) §5/§6.3；实体字段与状态机见 [`data-model.md`](../01-architecture/data-model.md)；逐路由签名与事件类型清单见 [`api-contract.md`](../01-architecture/api-contract.md)。
> 术语（同步 / 工作副本 / 采纳 / 撞车 / 规格页）以 [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md) 为权威；**对内文档直说 sync/merge/tombstone，对外 UI 零术语**（[宪法 4](../00-overview/vision-and-principles.md#44-宪法-4-去黑话de-jargon)）。
> 参照代码（已扎根）：[`spec_watch.rs`](../../../client-tauri/src-tauri/src/spec_watch.rs)、[`sync.rs`](../../../client-tauri/src-tauri/src/sync.rs)、服务端 [`project_drive.py`](../../../app/routers/project_drive.py) 的 `/drive/manifest` + `/drive/changes` + `/drive/undo`、[`sync.py`](../../../app/routers/sync.py) 的 `sync-manifest`/`sync-ack`、[`sync_manifest.py`](../../../app/services/sync_manifest.py)。

---

## 0. 一句话与本篇的三条地基

**同步 = 桌宠（C-PET）本地工作目录 ↔ daemon 真相源之间，把「单向下载」升级为「双向、按身份、可解冲突、可离线」的镜像协议；README = 每个 WorkItem/项目一份随澄清与交付自动维护的规格活文档，它本身也是被同步与被提议合并的对象。**

三条地基（约束全篇，承自架构决策）：

- **G-1 复用已验证的同步原语，不重造**：sha256 去重、`/drive/changes?since=<cursor>` 增量协议、`deleted_at` 墓碑（tombstone）、`version_no` 单调版本、chunked resumable upload、`replace_file_preserving_existing` 的安全替换、path-escape 守护——这些都已在现仓跑过真实并发，**原样继承**（见 [system-architecture §7 不变量](../01-architecture/system-architecture.md)）。
- **G-2 上行写不绕过宪法 5**：本地变更回传服务端，**不是静默 `UPDATE`**，而是走「提议（Proposal）→ 审批 → 合并」或「直接落版本但留痕可回滚」两条受控路径之一（[宪法 5](../00-overview/vision-and-principles.md#45-宪法-5-ai-绝不静默改生产态no-silent-production-writes)）。同步只是**搬运层**，合并裁决权在 [`branch-proposal-merge.md`](./branch-proposal-merge.md)。
- **G-3 冲突解决 = AI 给方案 + 人择一**：同步层只负责**检测冲突**并把它**升格为一个待解冲突对象**；解法（三路合并、AI 调解、对用户的「撞车了，选一个」表达）由协作层统一提供，本篇只定义**检测规则与移交契约**。

> 现状基线（为何要做）：今天客户端是**纯下载镜像**。`sync.rs:227` 的 `sync_drive_download` 注释明写「placeholder … this initial implementation does single-direction download」；`spec_watch.rs` 是**唯一的上行通道**，但它**append-only**（顶部注释：「local deletions never delete remote attachments」）且只覆盖「往 spec 文件夹丢附件」这一窄场景。WorkHub 要把上行从「只追加附件」扩成「双向镜像 + 冲突协商」。

---

## 1. 同步对象与命名空间（同步什么、按什么边界隔离）

同步不是「整盘镜像」，而是**按业务对象切片**。每个切片有独立的 manifest、独立的 cursor、独立的权限门。三类同步对象，现状各有锚点：

| 同步对象 | 本地路径形态 | 服务端真相 | 现状锚点 | 双向？ |
|---|---|---|---|---|
| **WorkItem 资产**（附件 + 规格 README + 元数据） | `{sync_root}/{project_slug}/{code}/` | `Requirement` + `Attachment` + `summary_md` | `sync.py:sync-manifest`、`sync_manifest.py:build`、`sync.rs:sync_requirement` | 下行已有；上行附件靠 spec_watch；**本篇补全双向** |
| **项目网盘**（文件树 + 版本 + 墓碑） | `{drive_sync_root}/{project_slug}/…` | `ProjectDriveItem` + `ProjectDriveVersion` | `project_drive.py:/drive/manifest`+`/drive/changes`、`sync.rs:sync_drive_download` | 下行已有；**本篇补全上行** |
| **规格 README**（WorkItem/项目的活文档） | `{…}/spec/README.md`（人/AI 可编辑） | `Requirement.summary_md`（演进）/ SpecDoc 实体 | `spec_watch.rs`（监听 spec 文件夹）、`models.summary_md`(`models.py:326`) | append-only → **本篇升级为受控双向** |

**命名空间 = 隔离边界**（承 `sync.rs:safe_component` / `safe_relative_path` 的 path-escape 守护）：
- 路径键 `{project_slug}/{code}` 直接复用现状（`sync_manifest.py:build` 已输出 `project_slug` + `code`）；`safe_component` 拒绝含 `/ \ :` 或 `. ..` 的分量，`safe_relative_path` 逐段校验、拒 `..`——**这是防止「同步把文件写到 sync_root 外」的硬约束，原样保留**。
- **设备令牌门**：所有同步 API 挂 `require_local_client`（`sync.py:89/99` 已如此），浏览器不可同步（[D-3](../01-architecture/system-architecture.md#0-一句话与三条架构地基)）。
- **资源门**：拉 manifest 前过 `can_view_requirement_assets` / `can_ack_requirement_sync`（`sync.py:93/103`）；网盘过项目级 `can_manage`。WorkHub 把这两道门**保留**并在 RBAC 下细化（[security-and-permissions](../01-architecture/security-and-permissions.md)）。

---

## 2. 双向同步协议（核心）

### 2.1 三层数据结构

#### 2.1.1 服务端 manifest（真相快照 / 增量）

复用并扩展现状两个端点（`project_drive.py:758/785`）。**全量 manifest** 用于首次/重置，**增量 changes** 用于稳态轮询：

```
GET /api/projects/{project_id}/drive/manifest        → 全量
GET /api/projects/{project_id}/drive/changes?since=<cursor>  → 增量（updated_at > since OR deleted_at > since）
```

`ManifestItem`（演进自 `DriveManifestOut.items` + `ManifestFile`，字段对齐 `sync.rs:ManifestFile`/`Manifest`）：

| 字段 | 类型 | 含义 | 现状来源 |
|---|---|---|---|
| `id` | `string(32)` | 对象稳定 id（跨重命名不变） | `ProjectDriveItem.id` |
| `path` | `string` | 相对 manifest 根的路径 | `_item_path_from_map` |
| `kind` | `"file" \| "folder"` | 类型 | `ProjectDriveItem.kind` |
| `sha256` | `string(64) \| null` | 内容指纹（folder 为 null） | `ProjectDriveVersion.sha256` |
| `size` / `size_bytes` | `int \| null` | 字节数 | `ProjectDriveVersion.size_bytes` |
| `version_no` | `int \| null` | 单调版本号（合并冲突的 base 锚点，见 §3） | `ProjectDriveVersion.version_no` |
| `mime` | `string \| null` | MIME | `ProjectDriveVersion.mime` |
| `deleted_at` | `datetime \| null` | **墓碑**：非空 = 服务端已软删 | `ProjectDriveItem.deleted_at` |
| `updated_at` | `datetime` | 末次变更（增量游标的依据） | `TimestampMixin.updated_at` |
| `updated_by` | `string` | 末次变更者（用于冲突归因 / 去黑话呈现「谁改的」） | `updated_by_user_id` |
| `download_url` | `string \| null` | 下载地址（同源校验，见 §2.5） | `/api/drive/files/{id}/download` |

顶层 `Manifest` 额外带 `cursor`（= 服务端时钟 `datetime.utcnow()`，`project_drive.py:780/809`）作为**下次 `since` 的值**。

> **为什么用 `updated_at` 游标而非自增 seq**：现状 `/drive/changes` 已是「`updated_at > since` OR `deleted_at > since`」（`project_drive.py:798`），cursor 取服务端 wall-clock。**迁 PostgreSQL 后建议升级为单调序列**（`xmin` 或专用 `change_seq` 列 + `LISTEN/NOTIFY`），消除时钟回拨/同毫秒并发的边界（见 §2.7 边界 B-3）。协议形状不变，只换 cursor 语义——这正是「契约稳定、实现可换」（[tech-stack §6.2](../01-architecture/tech-stack-and-migration.md)）。

#### 2.1.2 本地状态库（client-side sync DB）

现状 `spec_watch.rs` 用进程内 `Lazy<Mutex<HashMap>>`（`INFLIGHT_SHAS` / `PENDING_PATHS` / `RETRYING_PATHS`）跟踪在途状态——**够用但不持久**，重启即丢。双向同步需要一张**本地持久状态表**（Tauri 侧 SQLite/sled），记录「上次同步时本地与服务端达成的共识」，这是离线合并与冲突检测的基石：

`LocalSyncEntry`（每个同步对象一行）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `path` | `string` | 相对路径（`safe_relative_path` 规整后） |
| `remote_id` | `string` | 服务端对象 id |
| `base_sha256` | `string` | **last-synced 基线指纹**：上次双向同步成功时三方一致的内容 hash |
| `base_version_no` | `int` | 对应的服务端版本号（三路合并的 base 锚点） |
| `local_sha256` | `string` | 当前本地磁盘内容 hash（由 watcher 计算） |
| `local_dirty` | `bool` | 本地是否有未上行的改动（`local_sha256 != base_sha256`） |
| `last_synced_cursor` | `datetime` | 该对象参与的上次 changes 游标 |
| `state` | enum | `clean / local_dirty / pulling / pushing / conflict / tombstoned` |

> `base_sha256` 是**双向同步的命门**：没有它就无法区分「本地改了 vs 服务端改了 vs 都改了」。现状下行用「`target.exists() && local_sha == want` 则跳过」（`sync.rs:139` / `sync.rs:300`）只能判「要不要重下」，**判不了冲突**——补 `base_sha256` 后才能做三路对比（§3.1）。

#### 2.1.3 上行变更包（local → server）

本地侦测到 `local_dirty`，不直接 PUT 覆盖，而是封成一个 `UploadChange`：

| 字段 | 类型 | 含义 |
|---|---|---|
| `path` / `remote_id` | string | 目标对象 |
| `op` | enum | `create / update / move / delete`（对齐服务端 `ProjectDriveOperation.op_type` 实有取值——`project_drive.py:1520/1546/1555` undo 分支可见：`create`/`upload_new`/`replace`/`delete`/`restore`/`patch`(=重命名/移动)/`paste_copy`/`paste_cut`；本篇的 `move` 对应服务端 `patch`，`create` 对应 `upload_new`） |
| `base_version_no` | `int \| null` | **乐观锁 token**：声明「我基于服务端第 N 版改的」 |
| `content_sha256` | string | 新内容指纹（去重） |
| `upload_id` | string \| null | 已 init 的分块上传句柄（大文件） |

### 2.2 同步引擎主循环（状态流转）

每个同步对象在客户端跑一个有限状态机。下行复用 `sync.rs` 现成逻辑，上行与冲突为新增：

```
            ┌─────────────────────────────────────────────────────────┐
            │                       clean                              │
            └───────┬──────────────────────────────┬──────────────────┘
   本地文件变更      │                              │  收到 changes（远端动了）
   (watcher 触发)    ▼                              ▼
            ┌──────────────┐               ┌─────────────────┐
            │ local_dirty  │               │   pulling       │
            └──────┬───────┘               └────────┬────────┘
                   │ push 前先 pull 对账            │ 远端 sha == base → 直接落地
                   ▼                               │ (replace_file_preserving_existing)
            ┌──────────────────────────────┐       └────────┬────────┐
            │  reconcile(base, local, remote) │              │ 本地也 dirty?
            └──────┬───────────────┬─────────┘              ▼
        无远端变更 │               │ 远端也变了           ┌──────────┐
                   ▼               ▼                      │ conflict │
            ┌──────────────┐   ┌──────────┐               └────┬─────┘
            │  pushing     │   │ conflict │◄───────────────────┘
            └──────┬───────┘   └────┬─────┘
                   │ 200 OK         │ 升格为 Proposal 冲突对象
                   ▼                │ → AI 调解 → 人择一（branch-proposal-merge）
            ┌──────────────┐        │ 解完回灌选定内容
            │   clean      │◄───────┘
            └──────────────┘
```

**reconcile 三态判定**（client 侧，§3.1 给真值表）：对每个对象，比较 `base_sha256`（共识基线）、`local_sha256`（本地现状）、`remote.sha256`（manifest 现状）三方。

### 2.3 一次同步周期的步骤（push-pull-merge）

承 `sync.rs:sync_requirement` 的「拉清单→比对→传输→ack」骨架，扩成双向：

1. **Pull manifest/changes**：`GET …/changes?since=last_synced_cursor`。空响应 = 远端无变更。
2. **逐对象 reconcile**（§3.1 真值表）→ 分流到 `pulling` / `pushing` / `conflict`。
3. **下行（pulling）**：流式下载到 `*.download` 临时文件（`sync.rs:download_response_to_tmp_with_cancel`，**chunk-by-chunk 避免 OOM**），校验 `size` + `sha256`（不符即删临时文件并报错，`sync.rs:171-186`），再 `replace_file_preserving_existing` 原子替换（拒绝覆盖 symlink/目录，失败回滚备份，`sync.rs:648`）。更新 `base_sha256 = remote.sha256`。
4. **上行（pushing）**：
   - 小文件直传；大文件走 chunked `init → chunk/{idx} → finalize`（复用 `upload.rs` + `project_drive.py:843/891/931`，**resumable**：已传分块按 sha 跳过）。
   - 上行**携带 `base_version_no`** 作乐观锁。服务端 finalize 时：若 `existing.current_version.version_no != base_version_no` → **409 冲突**（远端在你 push 前又动了），客户端转 `conflict`。
   - 成功则服务端分配新 `version_no`（`project_drive.py:991` 的 IntegrityError 重试单调分配），返回新 manifest item；客户端 `base_sha256 = local_sha256`、`base_version_no = 新版本`。
5. **冲突（conflict）**：把对象升格为一个 Proposal 级冲突，移交 [`branch-proposal-merge.md`](./branch-proposal-merge.md) 的 AI 调解（§3.2）。**同步引擎在此对象上暂停**，但**不阻塞其他对象**（逐对象独立，承 `spec_watch.rs` 的 per-path generation 模型）。
6. **Ack**：周期结束 `POST …/sync-ack`（`sync.py:98`），服务端置 `sync_state="synced"`（`Requirement.sync_state`，`models.py:350`，取值 `pending`/`synced`/`failed`）。**现状 `sync_ack` 只改库不发事件**（`sync.py:99-108` 无 `bus.publish`）；WorkHub 在此补发「同步完成」事件以驱动其他客户端刷新（新增）。

### 2.4 事件契约（SSE）

同步既消费也产生事件，全部走现有事件总线（[system-architecture §5](../01-architecture/system-architecture.md)）：

| 方向 | 事件 | topic | 载荷 | 现状锚点 |
|---|---|---|---|---|
| 服务端→客户端 | `drive.changed` | `workitem:<id>` / `project:<id>`（演进自 `req:<id>`） | `{project_id, item_ids[]}` | `project_drive.py:_publish_drive_changed` |
| 服务端→客户端 | `requirement.updated` | `workitem:<id>` | 现状 `{status}`（`sync.py:82` 实测只发 `status`，**不含 `sync_state`**）→ WorkHub 在 ack 后补发 `sync_state`（新增字段，落地见 [api-contract](../01-architecture/api-contract.md)） | `sync.py:82`（`Requirement.sync_state` 列已存在，`models.py:350`，取值 `pending`/`synced`/`failed`，但当前未进 SSE 载荷） |
| 客户端 UI 进度 | `sync-progress` / `drive-sync-progress` | （本地 Tauri emit） | `{req_id/project_id, phase, percent, message}` | `sync.rs:emit_progress`（`phase`: manifest/download/skip/done/error）、`spec_watch.rs:emit_pending_progress`（`phase`: chunk/done/error） |
| 客户端→服务端 | 上行变更 | HTTP（非 SSE） | `UploadChange` / chunk | 普通 API |
| 服务端→应批人 | `sync.conflict`（新增） | `workitem:<id>` + `user:<owner>` | `{object_path, who_changed, ai_proposal_id}` | （新增，路由同 §3.2） |

> **「事件下行、动作上行」**：与审批同构（[system-architecture §5.3](../01-architecture/system-architecture.md)）——SSE 推「远端变了/撞车了」，客户端用普通 HTTP 回传变更与冲突选择。**MVP 不需要 WS**。SSE 仅作「该 pull 了」的触发器；真实增量仍走 `/changes` 拉取（避免把大 payload 塞进事件流）。

### 2.5 传输层安全（原样继承的硬约束）

这些是现仓踩坑沉淀的契约，**迁移期严禁重新发明**（[system-architecture §7 判断 1](../01-architecture/system-architecture.md)）：

- **同源下载校验**：`resolve_server_url_base`（`sync.rs:498`）拒绝 scheme/host/port 与 base 不一致的 `download_url`（防 manifest 注入把客户端引去外部 URL）。
- **path-escape 守护**：`ensure_dir_inside_root` / `ensure_parent_inside_root`（`sync.rs:596/635`）逐层 canonicalize 校验，确保写入点 `starts_with(root)`；`safe_component`/`safe_relative_path` 拒 `.. : / \`。
- **原子替换 + 回滚**：`replace_file_preserving_existing`（`sync.rs:648`）：先 rename 现有→备份，再 rename 临时→目标，失败则恢复备份并清临时；**拒绝覆盖 symlink/目录**。
- **墓碑删除的二次校验**：`remove_drive_tombstone`（`sync.rs:362`）删除前再 canonicalize 校验父目录与目标都在 root 内，且可被 cancel 打断（`remove_dir_tree_with_cancel` 逐项检查 `should_continue`）。
- **稳定快照后再 hash/上传**：`snapshot_stable_file`（`spec_watch.rs:945`）——两次 metadata（len + mtime）一致才认为文件写完，拷到临时再 hash，避免上传「正在被写」的半成品；不稳定则带退避重试（`MAX_STABILITY_RETRIES=5`、`STABILITY_RETRY_DELAY=3s`）。

### 2.6 失败处理与幂等（规则表）

| 失败场景 | 现状机制 | WorkHub 处置 |
|---|---|---|
| 下载 size/sha 不符 | `sync.rs:171-186` 删临时文件 + 返回 `size/sha256 mismatch` 错误 | 不替换目标；标该对象 `state=error`，下周期重试 |
| 上行 finalize 缺分块 | `project_drive.py:951` 400「missing chunks」 | 客户端补传缺失分块（resumable），不重传全量 |
| 版本号竞争（并发 finalize） | `project_drive.py:990` IntegrityError 重试单调分配 | 服务端侧透明重试；客户端只看到最终 `version_no` |
| 文件「还在写」 | `spec_watch.rs:snapshot_stable_file` 重试/跳过 | 同；超 `MAX_STABILITY_RETRIES` 放弃并 emit `error` |
| 同一内容多次事件 | sha256 去重：`claim_sha`/`known_shas`（`spec_watch.rs:575/717`） | **幂等核心**：上行前查服务端是否已有同 sha（`sync.py:sync-manifest` 列已知 sha），命中即跳过——天然抗「notify 多次触发」与崩溃恢复重传 |
| 同步对象竞态（停/重启） | `spec_watch.rs` 的 **generation token**（`generation_active` 校验，旧 generation 的回调静默作废） | 升级为「`base_version_no` 乐观锁 + generation」双保险；陈旧上行被服务端 409 拒 |
| 取消/暂停同步 | `ensure_continue`/`drive_sync_active`（`sync.rs:431/585`）逐步检查 | 同；冲突对象保留待解，恢复后续解 |
| 提交者双击/重复提交 | `sync.py:59` 的 **CAS**（`status.in_({summary_ready,ready})` 才翻 `ready`），rowcount==0 → 409 | 同步上行同样用 CAS/乐观锁，杜绝「两个 push 都过 in-memory 检查后盲写」 |

> **幂等三件套**：① sha256 内容寻址（重传同内容 = no-op）② `base_version_no` 乐观锁（陈旧写被拒）③ generation token（陈旧回调作废）。三者叠加，使同步在「网络抖动 + 进程崩溃 + 多次事件」下仍**最终一致**。

### 2.7 边界条件

- **B-1 文件夹 vs 文件**：folder 无 sha/版本，冲突只可能是「双方建同名异类」（一边文件一边文件夹）或「一边删一边在其下新增」。前者按 §3.1 当冲突；后者：删除墓碑下达时，若本地该子树有 `local_dirty`，**不静默删**，升格冲突（对比现状 `spec_watch` 的 append-only：本地删不传播，此处反向——远端删不无条件落地）。
- **B-2 重命名/移动**：靠 `remote_id` 稳定身份识别 move（path 变、id 不变），避免「删旧+建新」丢历史。对齐服务端：重命名/改父走 `op_type=patch`（`project_drive.py:1546` undo 按 `old_name`/`old_parent_id` 还原），剪切粘贴走 `paste_cut`（`project_drive.py:1555` undo 按 `old_state.name`/`old_parents` 还原）。
- **B-3 cursor 时钟边界**：`updated_at` 游标在「同毫秒多次写」或时钟回拨时可能漏/重。**重取整毫秒边界对象幂等可吞**（sha 去重）；PG 化后换单调序列根除（§2.1.1）。
- **B-4 大文件**：全程流式（下行 `bytes_stream`、上行 chunked），`MAX_BYTES` 上限（`project_drive.py:852` 413）；manifest 超 `_MANIFEST_MAX_ITEMS` 时日志告警并应走 `/changes` 增量（`project_drive.py:767`）。
- **B-5 spec_watch 的 append-only 例外**：现状 spec 文件夹**本地删不删远端附件**（防误删，`spec_watch.rs` 顶注）。**此约束对「附件投放」保留**；但对「规格 README 双向同步」**不适用**——README 是受控合并对象（§4），删/改走 Proposal。

---

## 3. 冲突解决（AI 给方案 + 人择一）

### 3.1 冲突检测：三路真值表

同步层用 `base / local / remote` 三方 sha 判定，**这是本篇唯一负责的算法**（合并算法本身在 branch-proposal-merge）：

| base==local | base==remote | local==remote | 判定 | 处置 |
|:---:|:---:|:---:|:---:|---|
| ✓ | ✓ | ✓ | 无变更 | `clean`，跳过 |
| ✓ | ✗ | — | **仅远端改** | `pulling`：下载落地，更新 base |
| ✗ | ✓ | — | **仅本地改** | `pushing`：上行（带 base_version_no） |
| ✗ | ✗ | ✓ | 双方改成同样 | 收敛：直接更新 base（无需传输） |
| ✗ | ✗ | ✗ | **真冲突** | `conflict`：升格 Proposal 冲突，AI 调解 |
| 墓碑 | — | local_dirty | **删/改冲突** | `conflict`（远端删、本地改）→ 人决定「恢复并采纳我的改动 / 接受删除」 |

> 对齐现状下行的「sha 命中跳过」（`sync.rs:139`/`sync.rs:300`）——那是上表第 1 行的退化。补 `base` 维度后，第 2–6 行才可区分，双向才成立。

### 3.2 冲突移交契约（→ branch-proposal-merge）

同步层**只检测、不解**。检测到真冲突后：

1. 客户端把 `{remote_id, base_version_no, local_sha256, remote_sha256, 本地内容快照}` POST 到冲突登记端点（该路由属 Proposal 创建面，签名定义在 [`branch-proposal-merge.md`](./branch-proposal-merge.md) / [api-contract](../01-architecture/api-contract.md)，本篇只约定上述移交载荷字段）。
2. 服务端创建一个**冲突 Proposal**（复用 Branch/Proposal 实体，[`branch-proposal-merge.md`](./branch-proposal-merge.md)），把「本地工作副本」与「服务端当前版」作为两个待合并源。
3. **AI 调解**：按对象类型（文档类 vs 结构化记录类，合并语义分类在 branch-proposal-merge 定义）生成合并建议 + 「为什么这样合」的人话理由（[宪法 5 可解释](../00-overview/vision-and-principles.md#45-宪法-5-ai-绝不静默改生产态no-silent-production-writes)）。
4. **人择一**：UI 呈现为「**和别人的改动撞了，AI 给了一个合并方案，你选：用 AI 的 / 用我的 / 用对方的**」（去黑话，[宪法 4](../00-overview/vision-and-principles.md#44-宪法-4-去黑话de-jargon)）。**绝不出现 "merge conflict / resolve / HEAD" 等术语**。
5. 选定后回灌：选定内容作为新版本合并入 main（服务端分配新 `version_no`），客户端同步该新版本并 `base_sha256 = 选定内容 sha`，对象回 `clean`。

> **职责切分**：检测规则（§3.1）+ 移交载荷（本节）= 本篇；合并算法、对象类型语义、Proposal/Branch 数据结构、AI 调解 prompt = [`branch-proposal-merge.md`](./branch-proposal-merge.md)。两篇在「冲突 Proposal」这个对象上对接，不重复。

---

## 4. 离线编辑后合并

### 4.1 离线模型

桌宠常驻本地（C-PET），**离线即「拉不到 manifest」**。离线期间：
- 本地 watcher 继续工作（`spec_watch.rs` 的 notify + debounce 不依赖网络），把改动记进 `LocalSyncEntry`（`local_dirty=true`），但**上行队列积压**，不报错。
- `ensure_drive_sync_active` / generation 守护保证：离线时上行任务被 `operation cancelled` 优雅中止（`sync.rs:585`），不丢状态（已持久到本地 sync DB——这正是 §2.1.2 要持久化而非进程内 HashMap 的原因）。

### 4.2 重连合并（reconnect reconciliation）

联网后**一次性 reconcile 全部积压**：

1. `GET …/changes?since=<离线前的 last_synced_cursor>` 取离线期间所有远端变更。
2. 对每个 `local_dirty` 对象，跑 §3.1 真值表：
   - 远端未动该对象 → `pushing`（带离线前的 `base_version_no`，服务端乐观锁校验；若远端在你离线期间也没动，version_no 仍匹配 → 直接收）。
   - 远端也动了 → `conflict` → §3.2 AI 调解。
3. 远端有、本地无 `local_dirty` 的对象 → 正常 `pulling`。
4. **顺序**：先 pull 远端新增/删除（建立最新 base），再逐个处理本地积压——避免「拿旧 base 去 push 撞上新 remote」。

### 4.3 离线边界

- **离线期间远端删了、本地改了**：真值表末行 → `conflict`，人决定（恢复采纳 / 接受删除）。**不静默丢本地工作**。
- **离线很久、cursor 失效/manifest 翻天**：若 `since` 早于服务端保留窗口，降级为**全量 manifest 重建 base**，再按 sha 对每个本地 `local_dirty` 文件单独 reconcile（退化为 §3.1 但 base 取「全量 manifest 中的当前版」——此时 `base==remote`，本地脏即 `pushing` 或冲突）。
- **多设备同一用户**：每设备独立 `LocalSyncEntry` + 独立 `base`；服务端单一真相 + 乐观锁仲裁，先到先得，后到者撞 409 转冲突。

---

## 5. README = 需求规格活文档

### 5.1 理念与现状锚点

每个 WorkItem/项目有一份 **README（规格活文档）= 单一可信源的门面**，AI 与人都对照它工作与验收（PRD §8.8）。现状已有雏形：
- `Requirement.summary_md`（`models.py:326`）：澄清后由 `llm_agent.summarize` 产出的需求摘要 Markdown。
- `sync.rs:sync_requirement` 已把它落地为本地 `requirement.md`（`# {title}\n\n{summary_md}`，`sync.rs:112`）。
- `spec_watch.rs` 已监听 `{…}/{code}/spec/` 文件夹（`WATCHABLE_STATUSES = [draft, clarifying, summary_ready]`，`spec_watch.rs:48`）。

WorkHub 把「`summary_md` 一次性快照」升级为「**随生命周期自动维护、且本身参与同步与合并的 README**」。

### 5.2 SpecDoc 数据结构与自动生成

`SpecDoc`（演进自 `summary_md`，可独立实体或 WorkItem 上的结构化字段；最终定型见 [`data-model.md`](../01-architecture/data-model.md)）：

| 字段 | 类型 | 含义 |
|---|---|---|
| `workitem_id` / `project_id` | string | 归属 |
| `body_md` | Text | README 正文（Markdown） |
| `sections` | jsonb | 结构化分节：`目标 / 验收清单 / 负责人 / DDL / 约束 / 变更历史` |
| `version_no` | int | 单调版本（同 drive，供合并 base 锚点） |
| `generated_by` | enum | `ai / human / merged`（每节可独立标注来源） |
| `last_synced_sha256` | string | 与本地 README.md 的同步基线 |

**自动生成/维护触发点**（挂在 `lifecycle.py` 的状态变更站点，承「所有 status 变更通知收一处」模式）：

| 触发 | README 动作 | 数据来源 |
|---|---|---|
| 澄清完成（→ `spec_ready`） | 生成初版 README（目标 + 验收清单 + 负责人 + DDL） | `llm_agent.summarize` + `RequirementAcceptanceItem`(`models.py:464`) |
| AI 工人产出 | 追加「交付摘要」节，链接 Proposal | AgentRun trace + Delivery |
| 打回带理由（`RevisionRequest.reason_md`，`models.py:542` 非空） | 追加「变更历史」节：记录打回理由与纠偏方向 | `RevisionRequest` |
| 验收项勾选变更 | 同步「验收清单」节的勾选态 | `RequirementAcceptanceItem.status` |
| 合并（→ `merged`） | 冻结该轮快照入「变更历史」 | Proposal merge 事件 |

> README 是**活文档**：每次澄清/交付/打回/验收都增量更新对应节，而非整篇重写——保证「变更历史」可追溯（呼应 [宪法 5 可解释](../00-overview/vision-and-principles.md#45-宪法-5-ai-绝不静默改生产态no-silent-production-writes)）。

### 5.3 README 的双向同步与合并（与 §2/§3 一致）

README 同时落在本地 `{…}/spec/README.md`，**人可直接编辑**（小白也能改规格）。它走与文件相同的双向协议，但有一处升级：

- **下行**：daemon 更新 SpecDoc → publish `drive.changed` → 客户端 pull → 落地 README.md（`replace_file_preserving_existing`）。
- **上行（关键升级，区别于 spec_watch 的 append-only）**：人在本地改了 README.md → watcher 侦测 `local_dirty` → **不直接覆盖 `body_md`**，而是按 §2.3 走「带 `base_version_no` 的受控上行」：
  - AI 当前未在该 WorkItem 工作 → 直接落新版本（留痕、可回滚，符合 G-2 第二条路径）。
  - AI 正在同一 WorkItem 工作（并发改 README）→ **撞车** → §3.2 AI 调解（文档类三路合并：人改了「验收清单」、AI 改了「交付摘要」→ 多数情况可自动合并不同节，仅同节冲突才要人择一）。
- **规格变更走提议→合并**（FR-SPEC-002）：README 的实质性变更（改目标/验收口径）与内容协作一致，经 Proposal 审批合并入 main，**与普通文件同一条路径**——这正是「README 本身也是被提议合并的对象」。

> **append-only 边界澄清**：`spec_watch.rs` 的「本地删不删远端」对**附件投放**保留（防误删）；但 README 是受控合并对象，其修改/删除走 Proposal，不适用 append-only（呼应 §2.7 B-5）。

### 5.4 去黑话呈现

README 在 UI 上就是「**这个活到底要做成什么样**」的说明页，不叫 "spec / README"，叫「需求说明 / 任务清单」。变更历史不叫 "commit log"，叫「这事是怎么一步步定下来的」。AI 自动更新时提示「我根据刚才的澄清更新了任务说明」，而非 "regenerated spec doc"（[宪法 4](../00-overview/vision-and-principles.md#44-宪法-4-去黑话de-jargon)）。

---

## 6. FR 映射与验收

| FR（PRD §8.7/§8.8） | 本篇落点 | 验收要点 |
|---|---|---|
| **FR-SYNC-001** 双向同步 | §2 全节 | 本地改动可上行；远端改动可下行；非 `local_dirty` 对象不被误推 |
| **FR-SYNC-002** 冲突 AI 给建议、人确认 | §3 | 真冲突升格 Proposal；AI 出合并方案 + 理由；UI 零术语「撞车了，选一个」 |
| **FR-SYNC-003** 离线编辑后合并 | §4 | 离线积压不丢；重连一次性 reconcile；删/改冲突不静默丢本地 |
| **FR-SPEC-001** README 自动维护 | §5.1/§5.2 | 澄清/交付/打回/验收各触发对应节更新；变更历史可追溯 |
| **FR-SPEC-002** 规格变更走提议合并 | §5.3 | README 实质变更经 Proposal 审批合并，与文件同路径 |

---

## 7. 与其他文档的边界（避免重复）

| 想了解 | 看哪篇 |
|---|---|
| 对象合并语义（文档类 vs 结构化记录类）、三路合并算法、AI 调解 prompt、Branch/Proposal 数据结构 | [`branch-proposal-merge.md`](./branch-proposal-merge.md) |
| 审批阻塞原语、打回带理由回灌、审批路由/SLA | [`review-and-approval.md`](./review-and-approval.md) |
| 同步是「桌宠↔daemon 数据流」的进程定位、事件总线/topic 体系、cursor→单调序列的 broker 演进 | [`system-architecture.md`](../01-architecture/system-architecture.md) §5/§6.3 |
| `sync.rs:227` 单向→双向、`spec_watch` 复用映射、SQLite→PG 的乐观锁落地 | [`tech-stack-and-migration.md`](../01-architecture/tech-stack-and-migration.md) §6/§7.3 |
| SpecDoc/Requirement 字段、`sync_state`、`version_no`、软删除/审计字段最终定型 | [`data-model.md`](../01-architecture/data-model.md) |
| 同步/changes/upload 逐路由签名、事件类型完整清单、`require_local_client` 依赖注入 | [`api-contract.md`](../01-architecture/api-contract.md) |
| 术语权威（同步 / 工作副本 / 采纳 / 撞车 / 规格页） | [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md) |

---

*本篇定位：同步**搬运层**的协议与冲突检测的单一来源。合并算法 → branch-proposal-merge；审批 → review-and-approval；进程边界 → system-architecture。*
