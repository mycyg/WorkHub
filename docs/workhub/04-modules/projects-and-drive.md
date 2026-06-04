---
module: M-DRIVE
layer: 业务模块（Business Module）— web + 桌宠两端
status: 🚧
owner: workflow
---

# 项目 + 网盘（M-DRIVE）— 全功能 + 页面规划

> **一句话**：M-DRIVE 是 WorkHub 的「共享文件中台」——一个项目（`Project`，`app/models.py:71`）下的文件树 / 版本 / 回收站 / 操作日志 / 文件夹留言（评论触发 LLM）。它今天已是相当完整的 web 网盘（`web/src/pages/ProjectDrive.tsx`，含树/平铺/列表三视图、分片上传、沙盒预览、复制剪切粘贴撤回、回收站、留言→需求草稿），桌宠侧是「最小本地盘 + 同步到本地」（`client-tauri/web-src/src/routes/ProjectDrive.tsx` + `client-tauri/src-tauri/src/sync.rs`）。本篇把这套**逐页**拆成 web 与桌宠两端的页面规划——完整路由清单、每页布局 / 组件 / 数据与 API 绑定 / SSE 实时订阅 / 四态（空·载入·错误·无权限）/ 关键交互与跳转流 / web↔桌宠差异，并尽量给文字版 wireframe；重点落在**预览 / 上传 / 同步**三类交互。
>
> **上游（已读以统一口径，交叉处只引用不复述）**：
> - 规格树索引（三端一核、模块地图、本篇范围）：[`../README.md`](../README.md)
> - 去黑话术语权威（同步/版本/回收站/历史记录/撤销）：[`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md)（§2「`clone/pull/push`→同步」「`revert`→撤销/还原」「软删除→移到回收站」）
> - 架构总图 / 进程边界 / SSE topic / 设备令牌门：[`../01-architecture/system-architecture.md`](../01-architecture/system-architecture.md)
> - 实体/字段/ER（Drive 家族原样迁移、`Branch` 内容载体）：[`../01-architecture/data-model.md`](../01-architecture/data-model.md)（§10「Drive 家族」、§11 ER）
> - OpenAPI 路由组与事件清单：[`../01-architecture/api-contract.md`](../01-architecture/api-contract.md)
> - 双向同步协议 / 冲突解决 / 离线 / README=规格活文档：[`../03-collaboration/sync-and-spec.md`](../03-collaboration/sync-and-spec.md)
> - 评论生成的需求草稿如何走澄清/执行：[`./requirements-workitem.md`](./requirements-workitem.md)（W3 澄清页）
> - **前向引用**：桌宠客户端壳（spec_watch / 托盘 / deep-link / 同步设置）→ [`../05-clients/desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)；web 路由表/导航 → [`../05-clients/web-app.md`](../05-clients/web-app.md)；版本回滚作为安全红线 → [`../01-architecture/security-and-permissions.md`](../01-architecture/security-and-permissions.md)。
>
> **参照代码（已读以扎根，下文引真实路径）**：`app/models.py:71/167/192/214/228`；`app/routers/project_drive.py`（全量 drive 端点）；web=`web/src/pages/{ProjectDrive,DriveHome}.tsx` + `web/src/App.tsx`；桌宠=`client-tauri/web-src/src/routes/ProjectDrive.tsx`；同步引擎=`client-tauri/src-tauri/src/sync.rs`、配置=`client-tauri/src-tauri/src/config.rs`、命令=`client-tauri/src-tauri/src/commands/sync.rs`、spec 同步=`client-tauri/src-tauri/src/spec_watch.rs`。

---

## 0. 范围与非范围

**本篇定义**：
- M-DRIVE 的**实体 / 文件树 / 版本 / 回收站 / 操作日志 / 评论→LLM**全功能与字段子集（§1–§3）。
- **web 端**页面规划：网盘入口（选项目）、项目网盘工作台（树/平铺/列表、上传、预览、复制剪切粘贴、回收站、撤回、留言板）（§5）。
- **桌宠端**页面规划：本地盘根列表 + 上传 + 同步到本地 + 项目交付物只读区（§6）。
- 预览 / 上传 / 同步三类交互的**交互流 + SSE/事件 + 四态 + web↔桌宠差异**（§4/§7/§8）。

**本篇不定义**（在邻篇，避免重复）：双向同步协议细节、冲突合并语义、离线队列、README=规格活文档 → [`sync-and-spec.md`](../03-collaboration/sync-and-spec.md)；版本/操作日志升级为全实体审计与快照回滚 → [`data-model.md`](../01-architecture/data-model.md) §9 + [`security-and-permissions.md`](../01-architecture/security-and-permissions.md)；评论生成的需求草稿后续如何澄清/执行 → [`requirements-workitem.md`](./requirements-workitem.md)；桌宠 Rust 侧的 spec_watch/托盘/deep-link/同步开关 UI → [`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)；分层 allow/deny/ask 与审批路由 → [`review-and-approval.md`](../03-collaboration/review-and-approval.md)。本篇**消费**这些产物，只规定网盘在**页面里怎么呈现与如何交互**。

**现状基线（诚实标注）**：今天 web 网盘功能已相当完整（`ProjectDrive.tsx` 847 行），桌宠网盘是「最小可用版本——只展示根目录、只支持上传到根、不做层级浏览」（`client-tauri/.../ProjectDrive.tsx:124` 注释原文），双向同步是「单向下载占位」（`sync.rs:227` 注释 `placeholder: full bidirectional ... single-direction download`，且 `config.rs:155` 强制把 `two_way` 模式回退为 `download`）。下文凡标 *(现状)* = 今天已有可直接移植；标 *(WorkHub 新增/演进)* = 需新建。WorkHub 的演进重点：①桌宠网盘补齐层级浏览/预览 ②双向同步落地（含冲突 AI 调解）③版本/操作日志收口为全实体审计+快照回滚 ④留言板→需求草稿接入 AI 默认执行主路径。

---

## 1. 实体与字段（Drive 家族，原样迁移）

> 全量字段与类型/约束以 [`data-model.md`](../01-architecture/data-model.md) §10 为权威（Drive 家族「原样迁移，仅 `requirement_id`→`work_item_id`、补 `workspace_id`/`deleted_at`、JSON→JSONB」）；此处给**页面渲染需要的字段子集**与现状锚点。四张表都复用 `TimestampMixin`（`created_at/updated_at`，`models.py:20`）、`uid()` 主键。

### 1.1 `Project`（项目，`models.py:71`）*(现状)*
| 字段 | 页面用途 | 锚点 |
|---|---|---|
| `id` / `name` / `slug` | 网盘标题、面包屑、同步根目录命名（`{slug}/...`） | `:74-76` |
| `owner_user_id`（权威）/ `owner_nickname`（显示快照） | 归属、删除/归档权限裁决 | `:82-83`（注释：权限**永远**用 `owner_user_id`，防重名继承） |
| `archived` / `deleted_at` / `deleted_by_nickname` | 归档/回收站态、软删除 | `:84-86` |
| `drive_items`（关系，`cascade=all,delete-orphan`） | 项目删 → 文件树级联删 | `:90` |

### 1.2 `ProjectDriveItem`（文件/文件夹节点，`models.py:167`）*(现状)*
| 字段 | 页面用途 | 锚点 |
|---|---|---|
| `project_id` / `parent_id`（自引用，`ondelete=CASCADE`） | 树结构、面包屑、当前目录列表 | `:171-172` |
| `name` / `kind`（`file\|folder`） | 列表名/图标、文件夹可进入 | `:174-175` |
| `current_version_id` | 指向当前版本（内容/大小/预览源） | `:176` |
| `created_by` / `updated_by` / `deleted_by`（FK→users） | 「谁建/谁改/谁删」、操作归属 | `:178-181/187-189` |
| `deleted_at` | 软删除 = **回收站**（人话「移到回收站，可恢复」，见 glossary §2） | `:180` |

### 1.3 `ProjectDriveVersion`（版本，`models.py:192`）*(现状)*
| 字段 | 页面用途 | 锚点 |
|---|---|---|
| `item_id` / `version_no`（`UniqueConstraint item_id+version_no`） | 列表「版本 v{n}」列、版本历史 | `:194/197-198` |
| `filename` / `mime` / `size_bytes` | 大小列、预览类型判定、下载名 | `:200-202` |
| `storage_path` / `sha256` | 落盘路径、**内容寻址去重**（同步 skip 依据） | `:203-204` |
| `parsed_text` / `parsed_text_path` | 预览文本（Office/代码截取） | `:205-206` |

> **版本是 WorkHub「撤销/还原到改之前」（glossary §2 `revert`）与 `Branch` 内容载体的现实底座**：data-model §6.1 注明 branch 的「改动」不进结构化列，而是引用 `ProjectDriveVersion`（内容寻址 `sha256`+`storage_path`）。本篇页面侧只需呈现「版本号 + 可回看历史」；回滚/快照语义在安全篇。

### 1.4 `ProjectDriveOperation`（操作日志，`models.py:214`）*(现状)*
| 字段 | 页面用途 | 锚点 |
|---|---|---|
| `actor_user_id` / `op_type` / `payload_json` | 「谁做了什么」、撤回的依据 | `:219-221` |
| `undone_at` | **可撤销**标记（人话「撤回/撤销」，glossary §2） | `:222` |

> 这是 web 网盘「撤回」按钮（`Ctrl+Z`，`ProjectDrive.tsx:410`）的后端载体，也是 data-model §9 全实体 `AuditLog`（`undone_at` 范式沿用）的雏形。

### 1.5 `ProjectDriveComment`（文件夹留言→LLM，`models.py:228`）*(现状，护城河雏形)*
| 字段 | 页面用途 | 锚点 |
|---|---|---|
| `folder_id`（可空=根） / `body` / `author_nickname` | 留言板气泡 | `:233-235` |
| `status`（`pending_llm\|posted\|draft_created\|review_failed`） | 留言态徽标（审核中/已入板/已生成草稿/审核失败） | `:237` |
| `llm_kind` / `llm_reason` | 「LLM：…」副文案（为何判为需求/普通留言） | `:238-239` |
| `draft_requirement_id`（FK→requirements，`SET NULL`） | 「去澄清」按钮跳转目标 | `:240` |

> **易混词**（glossary §4）：`ProjectDriveComment`（网盘留言，过 LLM、可生草稿）≠ `Comment`（`models.py:545`，需求评论，不过 LLM）。本篇只涉及前者。

---

## 2. 文件树 / 版本 / 回收站 / 操作日志 / 评论（功能全景）

> 端点权威见 [`api-contract.md`](../01-architecture/api-contract.md)；此处给「功能 → 现状端点 → 页面落点」对照（端点取自 `app/routers/project_drive.py`）。

### 2.1 文件树与浏览 *(现状)*
- **列目录**：`GET /api/projects/{id}/drive`（`project_drive.py:691`，返回 `items` + `breadcrumbs`，支持 `parent_id`/`search`/`trash` 参数）。
- **整树**：`GET /api/projects/{id}/drive/tree`（`:734`，左侧树导航数据源）。
- **页面落点**：W2 主区三视图（列表/平铺/树）+ 左侧树（§5.2）。

### 2.2 版本 *(现状)*
- 上传同名文件冲突时可「替换」→ 生成新 `version_no`（`init` 返回 `conflict=name_exists`，前端弹「r 替换 / n 存新名 / c 取消」，`ProjectDrive.tsx:269-285`）。
- 列表「版本」列显 `v{version_no}`（`:737`）。**WorkHub 新增**：点版本号 → 版本历史抽屉（看 `created_by`/时间/`sha256`，可还原——安全篇 §快照）。

### 2.3 回收站（软删除）*(现状)*
- 删 → `DELETE /api/drive/items/{id}` / `POST /api/drive/bulk-delete`（打 `deleted_at`，`:1427/1439`）；恢复 → `restore` / `bulk-restore`（`:1457/1477`）。
- 页面：W2 顶部「回收站」开关（`trash` 态，`ProjectDrive.tsx:219`），回收站视图里删除按钮换成「恢复」（`:610-620`）。

### 2.4 操作日志与撤回 *(现状)*
- 复制/剪切/粘贴/删除等写动作记 `ProjectDriveOperation`；撤回 `POST /api/projects/{id}/drive/undo`（`:1504`，按最近操作 `undone_at`）。
- 页面：W2 顶「撤回」按钮 + `Ctrl+Z`（`ProjectDrive.tsx:410-422`）。

### 2.5 文件夹留言 → LLM → 需求草稿 *(现状，接 AI 主路径)*
- 发留言 `POST /api/projects/{id}/drive/folders/{folder_id}/comments`（`:1595`）→ 先落 `pending_llm` 行并 `commit`（避免占用 SQLite 单 writer 跨 LLM 延迟，`:1620-1626` 注释；**D-2 换 PG 后此约束放宽**）→ `classify_drive_comment` 判类 → 若 `requirement_change` 则置 `posted` 并分配 `draft_requirement_id`（5 次 `IntegrityError` 重试抢 `code`，`:1645-1654`）。
- 页面：W2 底「文件夹留言板」（§5.2）：留言后徽标流转、生成草稿则出「去澄清」→ `/r/{draft_id}/clarify`。
- **WorkHub 演进**：今天草稿落地后仍要人去澄清；WorkHub 把「像需求的留言」直接接入 J2 主路径——草稿可一键「让 AI 先试」（见 [`requirements-workitem.md`](./requirements-workitem.md) §5.3 W3）。

---

## 3. 上传 / 预览 / 下载（三类核心交互的机制）

### 3.1 上传（分片，`web` 三段式）*(现状)*
现状流程（`ProjectDrive.tsx:244-308` + `project_drive.py`）：
1. `init`：`POST /drive/upload/init`（`:843`）→ 回 `upload_id` / `chunk_size` / 冲突判定（`conflict=name_exists` 时带 `existing_item`）。
2. `chunk`：循环 `PUT /drive/upload/{upload_id}/chunk/{idx}`（`:891`），前端按 `CHUNK_SIZE=5MB`（`ProjectDrive.tsx:12`）切片。
3. `finalize`：`POST /drive/upload/{upload_id}/finalize`（`:931`）→ 落 `ProjectDriveItem`+`ProjectDriveVersion`，回新 item。
- **入口**：上传按钮 / 拖拽到主区（`onDrop`，`:487-491`）/ 空态 CTA。冲突弹「替换/存新名/取消」（`:269`）。
- **并发守卫**：`uploadBusyRef` + `uploadToken`（单 token 防乱序，`:247-249`），`hasDriveAction()` 拦截并发动作（`:176`）。
- **桌宠侧**：走 Tauri `invoke('upload_drive_item')`（本地文件路径，非浏览器 `File`），进度经 `drive-upload-progress` 事件（§6.2）。

### 3.2 预览（按扩展名分派）*(现状)*
`GET /api/drive/files/{item_id}/preview`（`:1218`）返回 `DrivePreviewOut`，`preview_type` 五态：
| `preview_type` | 触发扩展名/条件 | 前端渲染（`ProjectDrive.tsx:813-844`） |
|---|---|---|
| `pdf` | `.pdf` | `<iframe src=render_url>`（`?inline=1`，`:837`） |
| `html` | `.html/.htm` | 切「沙盒预览」(`<iframe sandbox="">`，`:838`) / 「看源码」(`<pre>`) |
| `markdown` | `.md` / Office（`OFFICE_EXTS`，取 `parsed_text`） | `<pre>` 文本（`:839`） |
| `code` | `CODE_EXTS` 或 `mime` 以 `text/` 开头 | `<pre>` 文本 |
| `unsupported` | 其它 | 「暂时看不了，但文件还活着。先下载它，别跟它硬刚。」（`:1260`） |
- **页面**：W2 双击文件 / 预览按钮 → `Modal`（`@yqgl/shared`，`size=xl`，含下载 + 关闭，`:813`）。
- **HTML 安全**：渲染走独立 `GET /drive/files/{id}/render-html`（`:1125`）+ 前端 `sandbox=""`，杜绝脚本逃逸。
- **桌宠侧**：现状**无预览**（最小版仅列根），WorkHub 补齐（§6.5）。

### 3.3 下载 *(现状)*
- 单文件：`GET /api/drive/files/{item_id}/download`（`:1090`，`driveDownloadUrl(id)` 直链，`window.open`，`:332`）。
- 批量打包：`POST /api/drive/bulk-download`（`:1156`）→ blob → `project-drive.zip`（Firefox 需 anchor 入 DOM 才触发，`:344-348` 注释）。
- 桌宠交付物：`invoke('download_delivery')` 落本地（§6.4）。

---

## 4. 两端总纲：可见性 / 可操作性矩阵

> 这张矩阵是每页「谁能看到什么 / 按什么按钮」的裁决依据。
>
> **现状（诚实标注，权威 = `project_drive.py` 的本地守卫，不是 `permissions.py`）**：网盘**没有**复用 WorkItem 那套 `permissions.py` 的 `can_view_*`/`can_claim_*`（那些是 requirement 粒度，drive 只 `import is_admin`，`project_drive.py:48`），而是用三个**自带**守卫：
> - `_require_project`（`:67`）：仅校验**项目存在**，404 if 不存在——**不**做项目可见/成员校验，故**任意已登录用户**知道 `project_id` 即可列目录/预览/下载。
> - 写**新建**（建夹/上传）：只挂 `_require_project` + `current_user`（建夹 `:821`、上传 init `:850`）——**任意已登录用户**都能往任意项目网盘建夹/上传。
> - `_can_manage_project`（`:92`，= owner_user_id 命中 **或** `is_admin` 短路）+ `_require_manage_item`（`:104`）：**改既有 item**（重命名/移动/复制/剪切/删除/恢复）要求 **owner / admin / 该文件创建者**之一，否则 403「only the project owner, admins, or the file owner can change this drive item」。
>
> **WorkHub 演进（RBAC 收紧，*非现状*）**：把上面「读+建/传对任意登录用户全开」收敛为 **项目可见即可读、项目成员可写**，删除/归档项目仍 owner/admin；落地为 C-UIKIT 的 `usePermissions(project, me)` hook，规则外化进 `PermissionPolicy`（演进自硬编码守卫，见 [`security-and-permissions.md`](../01-architecture/security-and-permissions.md)、[`data-model.md`](../01-architecture/data-model.md) §8.1）。下表「现状锚点」列指向**今天真实代码**；可见性收紧前，旁观者其实也能读/建（这正是 WorkHub 要补的洞）。

### 4.1 角色（对网盘而言）
- **任意已登录用户** *(现状)*：浏览/预览/下载、**新建夹/上传/留言**（`_require_project` 仅查存在，`project_drive.py:67/821/850`）。**WorkHub 收紧**为「项目成员」。
- **owner / admin / 文件创建者** *(现状)*：才能改/删既有 item（`_require_manage_item`，`:104`）；owner（`Project.owner_user_id`）/ admin（`is_admin` 短路）另可归档/删除/恢复项目（`_can_manage_project`，`:92`，镜像 `projects.py::_require_owner`）。
- **旁观者**：*(现状)* 仍能读/建（无项目可见门）；*(WorkHub)* 无项目可见权 → 后端 403 → 走无权限态。

### 4.2 设备令牌门（D-3 延续，web↔桌宠差异之根）
> 来自 [`system-architecture.md`](../01-architecture/system-architecture.md)：**接活/干活/交付/同步到本地**类操作要求**桌面客户端**（服务端校验 `ClientDevice.client_token_hash`）。对 M-DRIVE，**网盘浏览/上传/预览/留言两端皆可**（不属高权限干活）；但**「同步到本地」「本地盘」「下载交付物到本地目录」是桌宠专属**——因为它们落地到用户本机文件系统（`drive_sync_root`，`config.rs:32`），web 浏览器无此能力。这是下面「web 无同步、桌宠才有」的统一原因。

### 4.3 矩阵

> ✅/❌ 指**该端 UI 是否提供此能力**，不代表已按角色鉴权——现状的读/建/传对任意登录用户全开（§4 intro），权限收紧是 WorkHub 演进项。「现状锚点」列指向真实代码行。

| 能力 | web（浏览器） | 桌宠（C-PET） | 现状锚点 |
|---|---|---|---|
| 浏览文件树 / 面包屑 / 三视图 | ✅ | ⚠️ 仅根列表（WorkHub 补层级） | web `ProjectDrive.tsx`；桌宠 `:543-670` |
| 预览（pdf/html/md/code/office） | ✅ | ❌（WorkHub 补） | web `:813`；桌宠无 |
| 上传（拖拽 + 分片 + 冲突处理） | ✅ | ⚠️ 仅上传到根、选文件 | web `:244`；桌宠 `:377` |
| 新建文件夹 / 重命名 | ✅ | ❌（WorkHub 补） | web `:228/424` |
| 复制 / 剪切 / 粘贴 / 多选 / 快捷键 | ✅ | ❌ | web `:389/446` |
| 删除→回收站 / 恢复 / 撤回 | ✅ | ❌（WorkHub 补） | web `:359/374/410` |
| 文件夹留言板 → LLM 草稿 | ✅ | ❌（WorkHub 补） | web `:758` |
| 下载单文件 / 批量打包 zip | ✅ | ✅（落本地） | web `:329` |
| **同步到本地**（download-only） | ❌（无本机 FS） | ✅（设备令牌门 + `drive_sync_root`） | 桌宠 `:455`；`sync.rs:229` |
| **本地盘根目录持有** | ❌ | ✅（`D:\工作需求\项目网盘\{slug}`） | `config.rs:80-90` |
| 下载需求交付物到本地 | ❌ | ✅ | 桌宠 `:300` |

---

## 5. web 端页面规划（C-WEB：完整网盘工作台）

> web 路由现状见 `web/src/App.tsx:161-166`：`/drive`（入口）、`/p/:id/drive`（项目网盘）。顶栏=全站共用 sticky glass `TopNav`（项目·看板▾·日程·通知·⌘K·主题·昵称，`App.tsx:185`），下文不再重画顶栏，只标「复用全局顶栏」。

### 5.0 路由清单（web，M-DRIVE 范围）

| # | 路由 | 页面 | 现状文件 | 本篇章节 |
|---|---|---|---|---|
| W1 | `/drive` | 网盘入口（选项目进网盘） | `DriveHome.tsx` | §5.1 |
| W2 | `/p/:id/drive` | 项目网盘工作台（树/平铺/列表 + 上传 + 预览 + 留言板 + 回收站） | `ProjectDrive.tsx` | §5.2 |

> 项目网盘也可从项目内 tab 进入（`ProjectView` 的「网盘」tab → `/p/:id/drive`，见 `ProjectDrive.tsx:521-535` 的项目级 tab 行：需求/网盘/会议）。

---

### 5.1 W1 — 网盘入口 `/drive` *(现状 `DriveHome.tsx`)*

**职责**：列出我可见的项目，点一个进它的网盘。轻量中转页（「每个项目的文件分开管理」`DriveHome.tsx:31`）。

**布局（文字版 wireframe）**：
```
项目网盘 ‹eyebrow›
🖴 项目网盘
先选项目，再进对应网盘。每个项目的文件分开管理。
┌ paper-surface 列表 ──────────────────────────┐
│ 📁 {project.name}              {slug}      → │ ← 点 → /p/:id/drive
│ 📁 …                                          │
└───────────────────────────────────────────────┘
```

- **布局**：无侧栏，`narrow-container` + 单 `paper-surface` 列表。**复用全局顶栏**。
- **关键组件**：项目行（`Link to=/p/:id/drive`，`:45`）、`FolderKanban` 图标、悬停右移箭头。
- **数据 & API**：`api.listProjects()`（`:15`，`reloadTick` 触发重载）。
- **SSE 订阅**：无（项目列表低频；新建项目后返回此页自然刷新）。
- **四态**：
  - **空**：「还没有项目，先建一个项目再用网盘。」（`:41`）。
  - **载入**：依赖 `projects` 初值 `[]`，加载中即空列表（WorkHub 可补骨架）。
  - **错误**：「项目加载失败：{err}」+ [重试]（`:36`；注释明说：没这个 catch，加载失败会和「全新无项目」长得一模一样，`:17-19`）。
  - **无权限**：未登录 → 全局 `NicknameDialog`（`App.tsx:78`）。
- **关键交互/跳转**：行点击 → W2。
- **响应式**：行 `flex items-center justify-between`，移动端自适应。
- **web↔桌宠差异**：桌宠对等入口=「选一个项目进入它的共享文件区」的项目选择器（`client-tauri/.../ProjectDrive.tsx:500-540`，`/p` 无 `projectId` 时的 Card 网格），但桌宠走 `invoke('list_my_projects')`（只列我加入的）而非 web 的全量 `listProjects`。

---

### 5.2 W2 — 项目网盘工作台 `/p/:id/drive` *(现状 `ProjectDrive.tsx`，核心页)*

**职责**：一个项目的完整文件管理中枢——浏览（三视图）、上传、预览、组织（复制/剪切/粘贴/重命名/新建夹）、回收站、撤回、文件夹留言→需求草稿。M-DRIVE 最重的页面。

**布局（文字版 wireframe）**：
```
[← project tab: 需求/网盘/会议]
项目网盘 ‹eyebrow›
🖴 {project.name}              [回收站][撤回]
🍞 项目网盘 › {folder} › {subfolder}   [回收站 pill?]
─────────────────────────────────────────────────────────
┌ aside 左栏(260px,树) ─┐ ┌ section 主区 ───────────────────────────┐
│ 🖴 项目网盘            │ │ ┌ 工具条 ─────────────────────────────┐ │
│  ├ 📁 folderA         │ │ │ [🔍搜索这个项目的文件]               │ │
│  │  └ 📁 sub          │ │ │ [+新建夹][⬆上传][复制][剪切][粘贴]   │ │
│  └ 📁 folderB         │ │ │ [下载][删除/恢复]   [列表|平铺|树]▣  │ │
│  (还没有文件夹?)       │ │ └──────────────────────────────────────┘ │
│                       │ │ ‹状态条: [⟳上传 X][📋复制了N项][❌err]›    │ │
│                       │ │ ┌ 内容区(min-h 460) ──────────────────┐ │ │
│                       │ │ │ ☑ 名称        大小   版本  更新  操作 │ │ │
│                       │ │ │ ☐ 📁 sub       -    -    …    [改名] │ │ │
│                       │ │ │ ☐ 📄 a.pdf   1.2MB  v2   …  [👁⬇改名]│ │ │
│                       │ │ └──────────────────────────────────────┘ │ │
└───────────────────────┘ └────────────────────────────────────────────┘
┌ 文件夹留言板(非回收站时) ─────────────────────────────────────────────┐
│ 💬 文件夹留言板    [同步：客户端本地开关控制]                          │
│ 留言会先过一遍 LLM；像需求变动的，会自动生成需求草稿。                │
│ [textarea ……………] [留言]                                              │
│ ┌ {author} ──────────────── [已生成草稿/已入板/审核失败][去澄清] ┐    │
│ │ {body}    LLM：{reason}                                          │    │
│ └─────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
‹弹层: 预览 Modal（xl）›
```

- **顶栏**：复用全局顶栏。**项目级 tab**：需求/网盘/会议（`:521-535`）。**侧栏（左 260px）**：文件夹树（`TreeButton` 递归，`:41-69`；空态「还没有文件夹」`:548`）。**主区**：工具条 + 状态条 + 内容区（三视图切换）。**弹层**：预览 `Modal`（`:813`）；重命名为行内 inline input（`:713`）；新建夹/上传冲突用 `window.prompt`（`:230/270`，WorkHub 可升级为正式 Modal）。
- **关键组件**：`TreeButton`（树）、三视图渲染块（list `<table>` `:687` / grid 卡 `:654` / tree 扁平 `:675`）、`Modal`（预览，`@yqgl/shared`）、状态 pill（busy/clipboard/err，`:641`）、留言板 `<article>` 卡 + 状态徽标（`:784`）。图标全 `lucide-react`（`Folder/FileCode2/Eye/Download/Trash2/RotateCcw/…`）。
- **数据 & API 绑定**：`reload()` 并行三拉（`:148`）：`listProjects` + `listDrive(projectId,{parent_id,search,trash})` + `driveTree(projectId)`，随后 `listDriveComments(projectId, trash?null:parentId)`。写动作：`createDriveFolder`/`uploadDriveChunk`(三段式)/`previewDriveItem`/`bulkDownloadDrive`/`driveDownloadUrl`/`bulkDeleteDriveItems`/`bulkRestoreDriveItems`/`pasteDriveItems`/`undoDrive`/`patchDriveItem`(重命名)/`addDriveComment`。**竞态防护**：`reloadTokenRef` 单调计数器（用户连续改搜索/切目录时，晚到的旧 `reload` 不覆盖新状态，`:115-118` 注释），动作用 `beginViewAction(lane)` 发 token + 校验 `viewKey`（`:167-174`）。
- **SSE 订阅**：*(现状：服务端已发事件，但本页不订阅)* —— 后端**每个写动作已 publish `drive.changed`**（到 `all` topic，`project_drive.py:270/278/839/...`），发留言/判类完 publish `drive.comment`（`:1700`）；但 web `ProjectDrive.tsx` **没有任何 SSE 订阅**，只靠 `viewKey` 变化与动作后 `reload()` 手动刷新（漏接他人改动）。**WorkHub 新增**：① 把 `all` 上的 `drive.changed` 收窄为 `drive:<projectId>` 专 topic（订阅前校验项目可见权，避免现状把所有项目的变更广播到 `all`——同 §7「去重/隔离铁律」与 [`api-contract.md`](../01-architecture/api-contract.md) §5.3 的 `all` 清退）；② 本页订阅之，收到即按当前目录差量刷新（**不打断**正在输入的搜索框/留言框——沿用 `RequirementDetail` 工作区的 dirty 守卫教训，见 [`requirements-workitem.md`](./requirements-workitem.md) §6.3）；③ 把 `drive.comment` 升级为带分类结果的 `drive.comment.classified`，实时把徽标从「审核中」翻为「已生成草稿/已入板」（替代现状被动等返回）。topic 隔离与鉴权见 [`system-architecture.md`](../01-architecture/system-architecture.md)。
- **四态**：
  - **空**：内容区「这里还没有文件。拖文件进来，或新建一个文件夹。」（`:651`）；树视图「树也空了，像一份还没开会的规划。」（`:683`）；留言板「还没人留言。这个文件夹暂时保持沉默。」（`:783`）；侧栏「还没有文件夹」（`:548`）。
  - **载入**：动作态 pill「⟳ {busy}」（如「上传 a.pdf」「打包下载」「丢进回收站」，`:643`）；初始 `drive===null` 时主区为空（WorkHub 可补骨架）。
  - **错误**：状态条红 pill「{err}」+ 关闭 ✕（`:645`）；竞态下只有「当前视图」的错误才落地（`isCurrent()` 守卫）。
  - **无权限**：无 `projectId` → 「先选个项目，网盘才知道该在哪儿安家。」（`:481`）；改/删非自己创建的文件越权 → 后端 403「only the project owner, admins, or the file owner can change this drive item」（`project_drive.py:104`）→ `err` 红条；删除/归档项目越权 → `_can_manage_project` 拒（`:92`）。*(现状读/建无可见门，故旁观者读/建不会 403；WorkHub 收紧后才有「项目不可见→403」态，见 §4。)*
- **关键交互/跳转**：
  - **浏览**：单击文件夹名 → `openFolder(id)`（重置留言状态、退出回收站，`:213`）；双击文件 → 预览（`:729`）；面包屑点击回跳（`:501`）；树/平铺/列表三视图按钮切换（`:621`）。
  - **上传**：拖拽到 `<main>` `onDrop` 或点上传选文件 → 分片上传（§3.1）→ 冲突弹「r/n/c」→ 完成 `reload()`。
  - **预览**：`Modal` 内 pdf/html(沙盒/源码切换)/md/code/unsupported 五态渲染 + 下载（§3.2）。
  - **组织**：多选（行/卡 checkbox，`:692/666`）→ 复制/剪切（写 `clipboard` 态）→ 粘贴 `pasteDriveItems`；`Ctrl+C/X/V/Z`、`Delete`、`F2` 全局快捷键（`:446-479`，预览开/输入框聚焦时禁用，`:449-450`）；删除前 `window.confirm`（`Delete` 太易误触，`:466` 注释）。
  - **回收站**：顶「回收站」切 `trash` 态 → 删除按钮变「恢复」→ `Delete` 键改为恢复（`:461`）。
  - **撤回**：「撤回」/`Ctrl+Z` → `undoDrive`（按最近操作）。
  - **留言→草稿**：留言 → 「审核中…」→ LLM 判类 → 「已生成草稿」则出「去澄清」→ `/r/{draft_requirement_id}/clarify`（`:801`）。
- **响应式**：主区 `grid lg:grid-cols-[260px_minmax(0,1fr)]`（`:538`，`lg` 以下树栏堆叠到主区上方）；工具条 `lg:flex-row`（`:555`）；平铺网格 `sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-6`（`:655`）；列表 `<table min-w-760>` 横向滚动（`:689`）；留言区 `md:flex-row`（`:770`）。
- **web↔桌宠差异**：见 §6——桌宠是「最小本地盘」（根列表 + 上传到根 + 同步到本地 + 交付物只读），**无三视图/预览/复制粘贴/回收站/留言板**；WorkHub 把桌宠补齐到接近 web，但桌宠**多出「同步到本地 + 本地盘根目录」**（web 无本机 FS）。

---

## 6. 桌宠端页面规划（C-PET：本地盘 + 同步）

> 桌宠 = Tauri v2 壳 + React webview。M-DRIVE 在桌宠属**派活/dispatch 空间**（与 web 网盘对应），路由 `/p`（项目选择器）与 `/p/:projectId`（项目网盘根）。骨架 = `TitleBar`(顶) + `Sidebar`(左) + 主区 + `FloatingAssistant`(右下浮窗)。桌宠侧的网盘是「最小可用版本」（`client-tauri/.../ProjectDrive.tsx:124` 注释），WorkHub 演进它向 web 看齐，但保留桌宠独有的「本地盘 + 同步」。

### 6.0 路由清单（桌宠，M-DRIVE 范围）

| # | 路由 | 页面 | 现状文件 | 空间 | 本篇章节 |
|---|---|---|---|---|---|
| P1 | `/p`（无 projectId） | 项目选择器（进入某项目网盘） | `routes/ProjectDrive.tsx`（`:500-540`） | dispatch | §6.1 |
| P2 | `/p/:projectId` | 项目网盘根 + 上传 + 同步到本地 + 交付物只读 | `routes/ProjectDrive.tsx`（`:543-707`） | dispatch | §6.2–§6.5 |

> 桌宠本地盘**根目录**由 `config.rs` 定义：`drive_sync_root`（默认 Windows `D:\工作需求\项目网盘`，`:80-83`；非 Windows 取 `~/工作需求/项目网盘`），同步落地 `{drive_sync_root}/{project_slug}/...`（`sync.rs:258`）。同步开关/模式 UI 归 `Settings.tsx`（[`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md)）。

### 6.1 P1 — 项目选择器 `/p` *(现状)*

**布局（文字版 wireframe）**：
```
项目网盘
选一个项目，进入它的共享文件区。
┌ Card grid (sm:2列) ──────────────┐
│ [🗂 {name} / {slug}]  [🗂 {name}] │ ← 点 → /p/:id
└───────────────────────────────────┘
```
- **数据 & API**：`invoke('list_my_projects')`（`:242`，只列我加入的）。
- **四态**：空「你还没加入任何项目」+「可以让管理员把你加进项目」（`EmptyState`，`:518`）；载入两条 `Skeleton`（`:513`）；错误「项目列表加载失败：{e}」glass 红条（`:510`）；无权限（未 onboarding 桌宠不到此）。
- **关键交互**：Card 点击 → `nav('/p/:id')`（`:525`）。
- **差异**：等价 web W1，但 Card 网格 + 桌宠设计系统（`Card/EmptyState/Skeleton` from `@yqgl/shared`）。

### 6.2 P2 — 项目网盘根（上传）*(现状)*

**职责**：桌宠用户给项目丢共享文档（「主要是为了让客户端用户也能丢规格文档」`:125`）。

**布局（文字版 wireframe）**：
```
[← 返回项目列表]
{project.name}                [会议纪要][⟳刷新][☁⬇同步到本地][＋上传文件]
团队共享文件，所有成员可见。
‹上传进度卡(glass): ⟳上传中  45% ▓▓▓░›    ← phase=finalize 显「拼装中…」
‹同步进度卡(glass): ⟳同步中  60% ▓▓▓▓░›
┌ 文件列表(glass) ─────────────────────┐
│ 📁 folder                     目录    │ ← 仅根，无层级进入(现状)
│ 📄 a.pdf                     1.2 KB   │
└───────────────────────────────────────┘
┌ 交付物（只读·来自需求交付）──────────┐  ← §6.4
│ {code} [status] {title}               │
│ 第N轮·M文件·KKB·{nickname}    [⬇下载] │
└───────────────────────────────────────┘
```

- **布局**：`flex-1 overflow-auto p-6`（`:545`）；header `sm:flex-row sm:justify-between`（`:553`）；进度卡 + 列表 + 交付物区纵向。无侧栏树（现状最小版）。
- **关键组件**：`Button`（secondary/ghost/accent，`@yqgl/shared`）、`Progress`（上传/同步进度，`:613/626`）、`Card`、`EmptyState`、`Skeleton`、`StatusBadge`（交付物）、`toast`。
- **数据 & API（经 Tauri `invoke`，非直接 fetch）**：列根 `invoke('list_drive_root',{projectId})`（`:284`）；上传 `invoke('upload_drive_item',{projectId,filePath,opId})`（`:406`，文件选择器 `@tauri-apps/plugin-dialog` `open`，`:114`）；同步 `invoke('trigger_drive_sync',{projectId,opId})`（`:471`）；交付物 `clientJson('/api/projects/{id}/deliveries')`（`:294`）。
- **事件订阅（Tauri event，非 SSE）**：
  - `drive-upload-progress`（`:343`）：`{req_id(=projectId), op_id, phase, sent, total}` → 进度卡；`phase==='done'` 600ms 后清。
  - `drive-sync-progress`（`:250`）：`{project_id, op_id, phase, percent}` → 同步卡；`phase==='done'` 时清 active + 900ms 后隐。
  - **进程级去重**：模块级 `Map<projectId,opId>`（`activeDriveUploads/activeDriveSyncs`，`:66-68`）+ 订阅器，保证切项目/重进同一项目时**正在跑的上传/同步不丢、不串**（`op_id` 比对，`:253/346`）。
- **并发互斥**：上传时禁同步、同步时禁上传（`uploadDisabled`/`syncDisabled` 互锁，`:364-365`）；Rust 侧 `ProjectDriveOpGuard::acquire`（`commands/sync.rs:30`，「该项目网盘正在上传或同步中，请稍候」）做进程级二次保险。
- **四态**：
  - **空**：「网盘是空的」+「点右上『上传文件』上传你的第一份共享文档」+ CTA（`EmptyState`，`:638`）。
  - **载入**：两条 `Skeleton`（`items===null`，`:632`）。
  - **错误**：glass 红条「{err}」（`:630`）+ toast（上传/同步失败分别提示，`:436/480`）。
  - **无权限**：未注册设备 → 后端 403 → toast；同步被禁/暂停 → `trigger_drive_sync` 直接 `Err`（`commands/sync.rs:32`「project drive sync is disabled or paused」）。
- **关键交互/跳转**：返回 → `/p`（`:547`）；会议纪要 → `/p/:id/meetings`（`:567`）；刷新 → 重列根（`reloadDrive`，`:367`）；上传 → 选文件→逐个 `invoke`→`refreshAfterUpload`（即便部分失败也刷新已传，`:425`）。
- **响应式**：桌宠固定窗口；header `sm:flex-row`，列表/卡纵向。
- **web↔桌宠差异**：见 §6.6。

### 6.3 同步到本地（download-only，现状核心交互）*(现状 + WorkHub 演进)*

**现状（单向下载占位）**：
- 触发：「同步到本地」按钮 → `invoke('trigger_drive_sync')` → Rust `sync::sync_drive_download`（`sync.rs:229`）。
- 流程（`sync.rs:229-360`）：拉 `GET /api/projects/{id}/drive/manifest`（`:241`，含 `project_slug`+`items[]`，每项有 `path`/`kind`/`download_url`/`sha256`/`size_bytes`/`deleted_at`）→ 落到 `{drive_sync_root}/{slug}/{rel}`（路径安全 `safe_relative_path`，拒 `..`/绝对路径，`:271/787`）→ **sha256 缓存命中即 skip**（`:300`）→ 流式下载到 `.download` 临时文件 → 校验 size+sha256 → 原子替换（`replace_file_preserving_existing`，先备份再 rename，`:648`）→ `deleted_at` 项做**墓碑删除**（本地删，`remove_drive_tombstone`，`:362`）。
- 安全/取消：每步 `ensure_drive_sync_active`（同步被关/暂停即中止，`:436`）；下载流可 200ms 轮询取消（`download_response_to_tmp_with_cancel`，`:535`）；拒绝越界路径/符号链接覆盖（`:505/653`）。
- 模式（`config.rs:37`）：`drive_sync_mode ∈ {off, download, two_way}`，但 `two_way` 被 `normalize_drive_mode` 强制回退为 `download`（`:155`，注释：two-way 已从 UI 移除，老配置会导致每 60s 打英文错误日志）；`trigger_drive_sync` 见到 `two_way` 直接报错（`commands/sync.rs:37`）。

**WorkHub 演进（双向同步，详见 [`sync-and-spec.md`](../03-collaboration/sync-and-spec.md)）**：
- 补齐**上行**：本地改动检测 → 冲突检测（sha256 + cursor）→ 撞车走 AI 调解（人话「你和别人的改动撞车了，AI 拟了方案」，glossary §2 `conflict`）。
- 用增量 `GET /api/projects/{id}/drive/changes?since={cursor}`（`project_drive.py:785`）替代全量 manifest 轮询（大盘 manifest 已有 `_MANIFEST_MAX_ITEMS` 告警，`:767`）。
- 页面侧：同步卡增「↑上传中 / ↓下载中 / ⚠ 撞车待你选」三态；冲突项点开 → AI 合并方案选择弹层。

### 6.4 项目交付物（只读区）*(现状)*

- **职责**：把项目下各需求的**交付包**（`Delivery`，`models.py:515`，按 `round` 版本化）在网盘里只读呈现，可下载到本地。
- **数据**：`clientJson('/api/projects/{id}/deliveries')`（`:294`）→ 每需求最新交付（`requirement_code`/`status`/`round`/`file_count`/`package_size`/`submitted_by`）。
- **交互**：「下载」→ `invoke('download_delivery',{reqId,deliveryId})`（`:313`）→ toast「已下载到本地」+ `saved_path`；进程级去重 `activeDeliveryDownloads`（`:64`），下载中禁其它下载（`:697`）。
- **四态**：`deliveries` 为空时整区不渲染（`:672`）；下载失败 toast。
- **差异**：web 网盘**无**此交付物区（web 看交付物在 WorkItem 详情页「交付物」tab，见 [`requirements-workitem.md`](./requirements-workitem.md) §5.4）；桌宠把它聚到网盘页，方便协作人「下活的成果」。

### 6.5 桌宠网盘 WorkHub 补齐项（向 web 看齐）*(新增)*
现状桌宠网盘缺：**层级浏览 / 预览 / 新建夹 / 重命名 / 复制粘贴 / 回收站 / 留言板**。WorkHub 补齐时复用 web 的端点（§2/§3 同一套 `project_drive.py`），UI 用桌宠设计系统重排：
- 层级浏览：复用 `listDrive(parent_id)` + 面包屑；侧栏树可选（窄窗可折叠）。
- 预览：复用 `preview` 五态（pdf/html 沙盒/md/code/unsupported），桌宠内嵌 webview 渲染。
- 留言板：复用 `addDriveComment` → 草稿 → 桌宠浮窗可直接「让 AI 先试」（接 J2，§2.5 演进）。
- 这些都**不需要**新后端，是纯客户端补全；落点与优先级见 [`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md) 与 [`../06-roadmap/phasing-p0-p5.md`](../06-roadmap/phasing-p0-p5.md)。

### 6.6 桌宠 spec 文件夹同步（与网盘的关系）*(现状，相邻能力)*
> 不是项目网盘，但同属 M-DRIVE 的「本地↔服务器文件」家族，且常被混淆，故澄清边界。
- `spec_watch.rs` 监听 `{sync_root}/{project_slug}/{code}/spec/`（**按需求**，非项目），把提交者丢进去的规格文件**自动上传为该需求的附件**（`Attachment`，非 `ProjectDriveItem`），**append-only**（本地删不删远端，`spec_watch.rs:1-8`），sha256 去重，仅在需求 `draft/clarifying/summary_ready` 态监听（`WATCHABLE_STATUSES`，`spec_watch.rs:48`）。
- **与项目网盘的区别**：项目网盘 = 项目级共享文件树（`ProjectDriveItem`，双向/可删/可组织）；spec 文件夹 = 需求级单向上行附件（喂澄清）。WorkHub 把 spec 文件夹演进为 **README=规格活文档**的本地侧（[`sync-and-spec.md`](../03-collaboration/sync-and-spec.md)）。本篇页面不含 spec 文件夹 UI（它无独立页面，是后台 watcher + 需求附件区呈现）。

---

## 7. 两端实时/进度订阅汇总（topic/event × 页面）

> web 走 SSE（`push_bus` topic）；桌宠网盘的进度走 **Tauri event**（Rust→webview，非 SSE），因为上传/同步是本机长任务。topic 体系与隔离以 [`system-architecture.md`](../01-architecture/system-architecture.md) 为权威。

| 通道 | 现状 | 端 / 页面 | 收到后动作 | 隔离 |
|---|---|---|---|---|
| `drive.changed` SSE → 收窄为 `drive:<projectId>` *(演进)* | 现状发 `all`、本页不订阅（`project_drive.py:278`） | web W2 | 文件树差量刷新（不打断输入）；版本/移动/删除实时反映 | 收窄到 `drive:<id>`，订阅前校验项目可见权 |
| `drive.comment` → `drive.comment.classified` SSE *(演进)* | 现状发 `all`（`:1700`）、徽标靠返回值 | web W2 留言板 | 徽标「审核中→已生成草稿/已入板/审核失败」实时翻牌 | 项目相关方 |
| `drive-upload-progress` Tauri event | `ProjectDrive.tsx:343` | 桌宠 P2 | 上传进度卡；`done` 600ms 清 | `op_id` 比对，进程内 |
| `drive-sync-progress` Tauri event | `ProjectDrive.tsx:250` / `sync.rs:345` | 桌宠 P2 | 同步进度卡；`done` 清 active + 900ms 隐 | `op_id` 比对 |
| `sync-progress` Tauri event（需求级） | `sync.rs:215` | 桌宠（需求同步，非本篇主体） | 需求文件同步进度 | 单需求 |
| `download_delivery` invoke 返回 | `ProjectDrive.tsx:313` | 桌宠 P2 交付物 | toast + 本地路径 | 进程内去重 |

> **去重铁律**（桌宠）：上传/同步/下载用模块级 `Map<id,opId>` + 订阅器（`ProjectDrive.tsx:64-102`），保证「快速切项目 / 重进同一项目 / StrictMode 双挂载」时正在跑的本机任务**不丢进度、不串项目、不重复触发**——这是现状代码大量 `aliveRef`/`token`/`opId` 守卫的目的，WorkHub 必须保留。

---

## 8. 响应式与 web↔桌宠差异（横切总结）

| 维度 | web（C-WEB） | 桌宠（C-PET） |
|---|---|---|
| **网盘完整度** | 完整：三视图/预览/上传/组织/回收站/撤回/留言板 | 现状最小：根列表 + 上传到根 + 同步 + 交付物（WorkHub 补齐，§6.5） |
| **浏览层级** | 树/平铺/列表 + 面包屑 + 搜索 | 仅根（现状）→ WorkHub 补层级 |
| **预览** | pdf/html(沙盒)/md/code/unsupported `Modal` | 现状无 → WorkHub 补 |
| **上传源** | 浏览器 `File` + 拖拽 + 分片(5MB) + 冲突弹窗 | 本机文件路径（`plugin-dialog`）+ `invoke` |
| **进度通道** | 动作态 pill（同步刷新） | Tauri event 进度卡 + 进程级 `opId` 去重 |
| **同步到本地** | ❌（无本机 FS） | ✅ download-only（`drive_sync_root`，WorkHub 补双向） |
| **本地盘根目录** | ❌ | ✅ `D:\工作需求\项目网盘\{slug}`（`config.rs`） |
| **交付物下载** | 在 WorkItem 详情「交付物」tab | 聚在网盘页只读区，下载落本地 |
| **组织操作** | 复制/剪切/粘贴/重命名/快捷键 | ❌（WorkHub 补） |
| **去黑话** | 全程人话（回收站/撤回/版本/同步），无 git 术语 | 同左；进度文案更口语（「拼装中…」「丢进回收站」） |
| **断网/响应式** | 浏览器自适应；SSE 断线自动重连 | 固定窗口；同步可暂停/取消（`drive_sync_paused`） |

---

## 9. 与其他文档的边界（避免重复）

| 想了解 | 看哪篇 |
|---|---|
| Drive 家族全量字段/类型/ER、`Branch` 内容载体、JSON→JSONB 迁移 | [`data-model.md`](../01-architecture/data-model.md)（§10/§11） |
| drive 端点完整 OpenAPI 形态、事件清单、鉴权中间件 | [`api-contract.md`](../01-architecture/api-contract.md) |
| 双向同步协议、冲突 AI 调解、离线队列、README=规格活文档、增量 `/changes` | [`sync-and-spec.md`](../03-collaboration/sync-and-spec.md) |
| 版本/操作日志升级为全实体审计 + AI 副作用快照回滚 | [`data-model.md`](../01-architecture/data-model.md) §9 · [`security-and-permissions.md`](../01-architecture/security-and-permissions.md) |
| 文件夹留言生成的需求草稿如何澄清/让 AI 执行 | [`requirements-workitem.md`](./requirements-workitem.md)（W3） |
| 桌宠 spec_watch / 托盘 / deep-link / 同步开关设置 UI / 本地盘根目录选择 | [`desktop-pet-tauri.md`](../05-clients/desktop-pet-tauri.md) |
| web 路由表 / 顶栏导航 / 设计系统 | [`web-app.md`](../05-clients/web-app.md) · [`shared-ui-kit.md`](../05-clients/shared-ui-kit.md) |
| 去黑话术语权威（同步/版本/回收站/撤销/历史记录） | [`glossary-dejargon.md`](../00-overview/glossary-dejargon.md)（§2） |
| 分层 allow/deny/ask 权限、审批路由（如删整个项目需批） | [`review-and-approval.md`](../03-collaboration/review-and-approval.md) |

---

## 10. FR 追溯（M-DRIVE 页面落点）

| PRD FR | 本篇页面落点 |
|---|---|
| FR-SYNC-*（双向同步、冲突解决、离线） | 桌宠 P2「同步到本地」演进双向（§6.3，详协议在 sync-and-spec） |
| FR-SPEC-*（README=规格活文档） | spec 文件夹同步（§6.6）→ sync-and-spec |
| FR-WORKER-001（默认派 AI 执行） | 留言→需求草稿一键「让 AI 先试」（§2.5/§5.2 演进） |
| FR-COLLAB-004（UI 无 git 术语） | 全篇用回收站/撤回/版本/同步（§8 去黑话行 + glossary §2） |
| FR-AUDIT-*/NFR-03（按身份审计 + 可回滚） | 版本历史 + 操作日志 `undone_at`（§1.3/§1.4）→ data-model §9 |
| NFR-04（AI 副作用快照可还原） | 版本号 + 「还原到改之前」（§2.2，安全篇落地） |

---

*本篇定位：M-DRIVE 的「页面规划单一来源」。机制级（双向同步/冲突/快照）→ 03-collaboration 与 01-architecture；数据级 → data-model §10；客户端壳级（spec_watch/托盘/同步设置）→ 05-clients。下一步：桌宠网盘补齐项（§6.5 层级/预览/留言）与双向同步（§6.3）的构建顺序随 [`../06-roadmap/phasing-p0-p5.md`](../06-roadmap/phasing-p0-p5.md) 落定。*
