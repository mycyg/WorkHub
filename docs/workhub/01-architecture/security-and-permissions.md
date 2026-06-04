---
module: P-PERM / P-AUDIT
layer: 平台底座 (Platform / Cross-cutting)
status: 🚧
owner: workflow
---

# 安全与权限（Security & Permissions）

> 本篇定义 WorkHub 的**威胁模型、身份与认证、设备令牌门、RBAC、分层 allow/deny/ask 权限策略、沙箱、按身份审计、AI 副作用快照回滚红线**。
> 范围边界:本篇只写"谁能做什么 / 在什么边界内做 / 留什么痕迹 / 出事怎么收";
> - 实体字段与状态机全量见 [`data-model.md`](./data-model.md);
> - 路由与事件契约全量见 [`api-contract.md`](./api-contract.md);
> - daemon/clients 进程边界与部署拓扑见 [`system-architecture.md`](./system-architecture.md);
> - 去黑话用户用语映射见 [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md)。
> 上游决策:PRD §8.6 / §10(NFR-02/03/04/08)/ D-2 / D-3,见 [`../../prd/2026-06-04-workhub-prd.md`](../../prd/2026-06-04-workhub-prd.md)。

WorkHub 的安全姿态由一句产品宪法收束:**AI 绝不静默改生产态——任何 AI 改动都可解释、可回滚、经审批才汇入 main**(PRD §5.5,延续现有 `app/models.py` 软删除/审计范式)。本篇把这句话拆成可实现的机制。

---

## 1. 威胁模型(Threat Model:可信 LAN → 云重审)

### 1.1 现状信任前提(继承自需求管理大师)

现有产品建立在**「可信局域网 + 昵称即身份」**前提上,这一前提在多处代码里被显式承认:

- `app/auth.py:1` 注释:*"Cookie-based nickname identity (no password; LAN-only use)"*——无密码,昵称即账号。
- `app/services/auto_agent.py:268` `_sandbox_rlimits()` 注释:*"Network egress is NOT blocked here … that residual is accepted under the trusted-LAN, opt-in, authenticated-author threat model"*——沙箱不封网,理由是 LAN 可信。
- `app/services/permissions.py:1` 注释:*"The app is still LAN/nickname based, so these helpers keep the current open dispatch board while protecting draft assets"*——派活板默认开放,只保护草稿与已分派工作。

WorkHub 继承这套地基(D-1),但 PRD **NFR-02** 明确要求:**威胁模型从"可信局域网"重审,尤其若上云**。下表把信任前提随部署形态(D-3)分级。

### 1.2 信任分级表(按 D-3 部署阶段)

| 部署形态 | 网络边界 | 身份强度 | 沙箱网络 | 跨租户隔离 | 本篇适用机制 |
|---|---|---|---|---|---|
| **LAN-first MVP**(P0–P4) | 可信内网,设备令牌门 | 昵称 + 签名 cookie + 设备令牌 + admin secret | egress 不封(LAN 可信,接受残余风险) | 无多租户(单 Org) | §2–§8 全部按现状继承 |
| **云就绪过渡**(架构预留) | 公网可达但单租户 | 同上 + 强制 HTTPS + 严格 CORS allowlist | **必须封 egress**(netns / 出站代理白名单) | Org 级行级过滤就位但未压测 | §1.3 升级项强制启用 |
| **多租户公网 SaaS**(P5) | 公网多租户 | 上述 + 真实账号体系(密码/OIDC,替换裸昵称) | 强隔离(容器/microVM)+ egress 白名单 | 每查询强制 `org_id` 谓词 + RLS | §1.3 全部 + 独立 SaaS 安全专题 |

### 1.3 上云强制升级项(LAN 残余风险的闭合清单)

每条对应一个 LAN-only 时被刻意接受的残余风险,上云前**必须**闭合:

| # | LAN 现状(残余风险) | 代码锚点 | 上云强制项 |
|---|---|---|---|
| R1 | 昵称即身份,任何人输入昵称即登录(admin 除外) | `app/routers/auth.py:63` | 引入真实凭据(密码 / OIDC / SSO),裸昵称仅作 LAN 模式 |
| R2 | 沙箱不封网络 egress | `auto_agent.py:278` | netns 隔离或出站代理白名单,禁默认外联 |
| R3 | `CORS_ALLOW_ORIGINS=["*"]` 默认放开 | `app/config.py:43` | 显式 allowlist(已有生产门禁 `main.py:232`,见 §3.4) |
| R4 | cookie `secure=False` 默认(允许 HTTP) | `app/config.py:13` | 强制 `cookie_secure=True` + HSTS |
| R5 | 单 Org,无行级租户过滤 | (现状无 Org 实体) | 每查询强制 `org_id` 谓词 + DB 行级安全(RLS) |
| R6 | admin_claim_secret 可为空(则拒绝新设备 admin) | `app/config.py:20` | 强制非空 + 轮换策略 |

### 1.4 资产 / 威胁 / 对手矩阵

| 资产 | 主要威胁 | 对手 | 现有缓解 | WorkHub 增量 |
|---|---|---|---|---|
| **业务数据(WorkItem/Drive/会议)** | 越权读写、AI 静默篡改 | 越权用户、被注入的 AI | 关系级访问检查 `permissions.py`;软删除保留引用完整性 | 快照回滚红线(§8)、按身份审计(§7) |
| **admin 权限** | 提权(冒名 admin 昵称) | LAN 内任意用户 | admin-claim 门 `routers/auth.py:74` | 角色矩阵化(§4) |
| **AI 执行环境** | 命令注入、资源耗尽、路径逃逸、提权 | 提示注入、恶意附件 | 沙箱(路径前缀/白名单/rlimit/预算)`auto_agent.py` | 工具按 actor 权限过滤(§5)、审批阻塞门(§6) |
| **私有事件流** | 跨用户泄漏 | 订阅了他人 topic 的客户端 | `require_stream_user` 鉴权 `auth.py:202` | 事件按身份隔离(NFR-08,§7.4) |
| **设备令牌 / cookie** | 窃取、重放 | 网络嗅探(HTTP 模式) | 令牌哈希入库、cookie 签名、可吊销 | 上云 R4 强制 HTTPS |

---

## 2. 身份与认证(Identity & Auth)

### 2.1 三种身份凭据(继承 `app/auth.py`)

| 凭据 | 载体 | 存储 | 用途 | 代码锚点 |
|---|---|---|---|---|
| **签名 cookie** | `yqgl_id` cookie(httponly/lax) | 服务端存 `User.cookie_token` 明文,cookie 内是 `itsdangerous` 签名值 | 浏览器身份(派活/审批) | `auth.py:22`、`issue_cookie:45` |
| **设备令牌(client token)** | `X-YQGL-Client-Token` header | DB 只存 `sha256(token)`(`ClientDevice.client_token_hash`) | 桌面客户端身份 + 设备门 | `auth.py:23/41`、`models.py:57` |
| **admin secret** | `/auth/identify` 请求体 `admin_secret` | 服务端配置 `settings.admin_claim_secret`(不入库) | 新设备认领 admin 昵称的二次门 | `config.py:20`、`routers/auth.py:74` |

> WorkHub 继承命名空间但概念演进:`User` → 仍是身份根;`ClientDevice` → 设备门载体;`StreamUser`(`auth.py:27`)→ 长连接(SSE/WS)用的轻量身份投影,**不持 DB session**(避免锁,见 `auth.py:202` 注释)。

### 2.2 认证解析顺序(关键算法)

`current_user`(`auth.py:104`)的解析顺序是一条**安全敏感的优先级链**,WorkHub 必须原样保留:

```
1. 取 X-YQGL-Client-Token header
   → _user_from_worker_token(): 查 ClientDevice WHERE token_hash=sha256(t) AND revoked_at IS NULL
                                 → 查 User WHERE id=device.user_id AND deleted_at IS NULL
   → 命中即返回(设备令牌优先于 cookie)
2. 否则取 yqgl_id cookie
   → _verify(): itsdangerous.loads(),签名不符返回 None(BadSignature 静默 → None)
   → 查 User WHERE cookie_token=token AND deleted_at IS NULL
3. 都失败 → 401 "not identified"
```

**边界条件(必须延续)**:
- **设备令牌赢过 cookie**:桌面 WebView2 的 cookie jar 与 Rust reqwest jar 是两套,WebView 可能携带过期/串号的浏览器 cookie,所以有效设备令牌优先(`auth.py:109` 注释)。
- **软删除即不存在**:所有解析都带 `deleted_at IS NULL`。admin "删除用户"后,即便对方仍持有效 cookie 也立即 401(`auth.py:116` 注释)。删除时还会轮换 `cookie_token`(`forget_user_cookie:249`)使所有在外 cookie 立即失效。
- **令牌解析不更新 `last_seen_at`**:`_user_from_worker_token` 刻意不写库——SQLite 单写锁会被请求全程持有导致并发 `database is locked`(`auth.py:94` 注释)。**D-2 迁 PostgreSQL 后此约束放宽**,可在认证路径安全地更新设备活跃时间(行级锁,非全库锁)。

### 2.3 昵称身份与 admin secret 门(提权防线)

LAN 昵称模型的核心风险:**任何人输入 admin 昵称就变 admin**。现有代码用一道二次门封死(`routers/auth.py:69`):

```
identify(nickname, admin_secret?):
  user, created = get_or_create_user(nickname)       # 普通昵称:复用现有账号
  if user.is_admin and (current is None or current.id != user.id):
      # 调用者不是"已经是这个 admin 本人"
      secret = settings.admin_claim_secret
      if not secret or not compare_digest(admin_secret or "", secret):
          raise 403 "该昵称是管理员账号，需要管理员口令才能在新设备登录"
  issue_cookie(user)
```

规则表:

| 场景 | `is_admin` | 调用者已是本人? | `admin_claim_secret` | 结果 |
|---|---|---|---|---|
| 普通昵称首次/复用 | False | — | — | 直接登录(LAN 开放心智) |
| admin 本人换设备 | True | 否(无 cookie/token) | 非空且匹配 | 登录 |
| 陌生人冒名 admin | True | 否 | 空 | **403 拒绝**(secret 为空 ⇒ 新设备认领 admin 一律拒) |
| 陌生人冒名 admin | True | 否 | 非空但不匹配 | **403 拒绝**(`compare_digest` 常量时间比较防计时攻击) |

> WorkHub 增量:secret 比较用 `secrets.compare_digest`(`routers/auth.py:77`)——常量时间,防计时侧信道,保留。
> 昵称校验 `_validate_nickname`(`routers/auth.py:30`):拒 `_deleted_` 前缀(防伪装已删账号视觉)、拒控制字符(`\r\n\t\x00`),UTF-8 中文/emoji 放行。WorkHub 保留并扩展(见 §7.3 模板注入防护)。

### 2.4 admin 授予(带外操作,不可经 API 提权)

admin 标志**只能带外授予**,不存在自助提权 API:`python scripts/set_admin.py <nickname>`(`scripts/set_admin.py:36` `grant()`)或首启 bootstrap——`YQGL_BOOTSTRAP_NICKNAMES` 环境变量(`scripts/set_admin.py:8/90`,首次会自动建号并授 admin)。

> ⚠️ 现状校准:`models.py:37` 注释提到的 `YQGL_ADMIN_NICKNAMES` 在当前代码**并无消费者**(全仓库无读取处),仅为遗留/未实现注释;唯一可用的环境变量入口是 `YQGL_BOOTSTRAP_NICKNAMES`。WorkHub 迁移时应删此误导注释或落实该入口。

这是刻意设计:RBAC 的最高位不能由请求路径触达。WorkHub 演进为治理后台的"授予角色"操作时,该操作本身必须是 admin-only 且写审计(§7)。

---

## 3. 设备令牌门(Device Token Gate)

### 3.1 语义:接活/干活需桌面客户端

PRD D-3 与 README §1 定的红线:**派活/审批浏览器可达;接活/干活类高权限操作要求桌面客户端**,服务端校验设备令牌。这是 daemon 侧的硬门,不靠客户端自觉。

### 3.2 依赖链(FastAPI Depends 三档守卫)

设备门不是一刀切,代码里实际存在**三档强度**(`auth.py`),WorkHub 演进时必须区分:

```
current_user                 # 任意有效身份(cookie 或设备令牌),401 if 无身份
  ├─ current_client_device   # 硬门:必须呈现"该 user 名下有效 ClientDevice",否则 403
  │    └─ require_local_client → 返回 device.user(干活类路由守卫)   auth.py:172/183
  └─ optional_local_client   # 软门:无 token → None 放行;有 token 但无效 → 403   auth.py:189
```

| 守卫 | 无 token | token 有效 | token 无效 | 锚点 |
|---|---|---|---|---|
| `require_local_client` / `current_client_device`(**硬门**) | **403** | 放行,返回 `device.user` | **403** | `auth.py:172/183` |
| `optional_local_client`(**软门**) | 放行(返回 `None`) | 返回 `device.user` | **403** | `auth.py:189` |

`current_client_device`(`auth.py:172`)逻辑:取 header token → `_lookup_client_device` 查 `WHERE token_hash=sha256(t) AND user_id=user.id AND revoked_at IS NULL` → 命中则更新 `last_seen_at` 并 commit(此处是即时 commit,与 §2.2 的认证路径区分)→ 否则 **403 "local client required"**。`optional_local_client`(`auth.py:189`)只在**呈现了 token**时才强制其有效,适配"浏览器也能调、桌面客户端调时顺带记录设备活跃"的混合路由。

> **admin 不豁免设备门**:`permissions.py:1` docstring 明确——*"Admins still need a registered client device to perform actions guarded by `require_local_client`"*。admin 只豁免**关系过滤**,不豁免**设备安全**。WorkHub 保留此正交性。

### 3.3 设备门覆盖范围(现状,`grep` 实证,WorkHub 演进基线)

> 务必区分硬门与软门——这是已踩实的语义差异,不可在演进中抹平。

| 路由模块 | 守卫强度 | 受守卫操作(锚点) | WorkHub 演进 |
|---|---|---|---|
| `routers/sync.py` | **硬门** `require_local_client` | manifest / ack / claim(`:89/99/112`) | Branch 检出 / Proposal 提交需设备门 |
| `routers/delivery_upload.py` | **硬门** `require_local_client` | 交付物分块上传 finalize(`:171/201/251`) | Delivery 打包仍需设备门 |
| `routers/workspaces.py` | **硬门** `require_local_client` | 进度更新、工作区操作(5 端点) | AgentRun(本地 Agent 能力)需设备门 |
| `routers/decompositions.py` | **软门** `optional_local_client` | 拆解发起 / 确认 / 撤销(`:81/157/207`) | PM 模式派活确认(注意:当前是软门,非硬门) |
| `routers/requirements.py` | **软门** `optional_local_client` | 部分干活态写操作(`:255/373`) | WorkItem 干活态写操作 |
| `routers/client_devices.py` | `current_client_device` | 设备自管理(current / revoke-current,`:62/89`) | 不变 |
| `routers/push.py` | `require_stream_user` | SSE 私有流订阅(`:54/64/96`) | 见 §7.4 事件按身份隔离 |

### 3.4 设备生命周期与吊销(`routers/client_devices.py`)

| 操作 | 端点 | 凭据要求 | 副作用 |
|---|---|---|---|
| 注册 | `POST /api/client-devices/register` | `current_user`(任意身份) | 生成 48 字节令牌,DB 存 `sha256`,**明文令牌只在响应里返回一次** |
| 列出我的设备 | `GET /me` | `current_user` | 已吊销排后、按 `last_seen` 倒序 |
| 吊销指定 | `POST /{id}/revoke` | `current_user` 且 `device.user_id==user.id` | 置 `revoked_at`;吊销后该令牌所有解析立即失败 |
| 吊销当前 | `POST /revoke-current` | `current_client_device` | 同上 |
| logout 连带吊销 | `POST /api/auth/logout` | `current_user` | 轮换 cookie_token + 吊销**所呈现的**令牌(`forget_presented_client_token`,按令牌而非按 cookie 用户,`auth.py:256`) |

**边界条件**:令牌不可逆(只存哈希),丢失即吊销重发;吊销是软标记(`revoked_at`),保留设备历史供审计。

---

## 4. RBAC 角色模型

### 4.1 现状:二元 admin + 每对象关系角色

现有产品没有完整 RBAC,只有:
- **全局二元**:`User.is_admin`(`models.py:38`)——True 时多数 `can_*` 检查短路为 True(但**不**短路设备门、写路径仍受项目活跃过滤约束,见 §4.4)。
- **每 WorkItem 关系角色**:`RequirementAssignment.role ∈ {lead, collaborator}`(`models.py:370`),外加隐式的 **submitter**(`Requirement.submitter_user_id`)。

### 4.2 WorkHub 目标角色(PRD §4 画像 → 角色)

WorkHub 演进为分层角色,作用域 `org → workspace → object`:

| 角色 | 作用域 | 来源 | 典型权限 | 现状映射 |
|---|---|---|---|---|
| **admin** | org | `set_admin.py` / 治理后台(带外或 admin-only) | 全量;读可见已删/已归档项目;授予角色;预算配额;读审计 | `is_admin` |
| **owner / reviewer** | workspace / object | WorkItem lead | 审批 Proposal(通过/打回)、改派、定高风险阈值 | `lead` |
| **dispatcher / submitter** | object | 创建者 | 提交、再派活、改自己工单的协作者 | `submitter` |
| **collaborator** | object | 被分派 | 在自己分支干活、提 Proposal | `collaborator` |
| **AI worker** | session | 系统(非人) | 受 actor 权限过滤的工具集(§5);改动经分级与审批 | (新增,见 §5.4) |
| **AI PM** | session | 系统(受阻态) | 派活/催办均"提议→人确认",不静默决策 | (新增) |

### 4.3 关系角色判定(`permissions.py`,WorkHub 继承)

纯函数,无副作用,易测试与移植:

```python
is_admin(user)                       # bool(user.is_admin)
is_submitter(req, user)              # req.submitter_user_id == user.id
is_assignee(req, user)               # 在 assignments 里
requirement_project_is_active(req)   # project 存在且未归档未删除
```

组合规则(节选 `permissions.py:50–119`):

| 能力 | 规则(admin 之外) | 关键约束 |
|---|---|---|
| `can_view_requirement_record` | submitter/assignee 可看;否则 `status ∉ {draft,clarifying,summary_ready}`(私有态) | 草稿期对外不可见 |
| `can_add_requirement_attachment` | submitter 且 `status ∈ {draft,clarifying,summary_ready}` | 仅起草期可加料 |
| `can_manage_requirement_assignees` | submitter 或当前 lead,且 `status ∈ ASSIGNMENT_EDITABLE_STATUSES` | lead 可在 submitter 离线时续派 |
| `can_claim_requirement` | `status=ready` 且(无显式分派 或 自己在分派内) | 防抢他人专属工单 |
| `can_work_requirement` | is_assignee | — |

> WorkHub 把这些函数升级为**作用域感知**(加 `org_id`/`workspace_id` 谓词),并把 `Requirement` 泛化为 `WorkItem`/`Proposal`,但**判定语义保持**——这是已验证的访问模型(PRD §11 复用清单)。

### 4.4 admin 的"读/写不对称"(关键边界,务必保留)

`permissions.py` docstring 定的细则,WorkHub 直接继承:

- **READ 路径**:admin 短路**所有**关系过滤**和**项目活跃过滤——admin 必须能审计任何历史状态,包括已归档/已删除项目(`can_view_*` 里 `is_admin` 在 `project_is_active` 检查**之前**)。
- **WRITE 路径**:admin 短路关系过滤,但**仍受项目活跃过滤约束**(`can_add_*`/`can_manage_*` 里 `project_is_active` 在 `is_admin` **之前**)。改归档项目会悄悄推翻"只读复盘态"契约;admin 要写须先 `POST /api/projects/{id}/restore`。
- **设备门**:admin **不**豁免(见 §3.2)。

---

## 5. 分层 allow/deny/ask 权限策略(借鉴 opencode)

### 5.1 定位:工具执行的运行时门

§4 的 RBAC 管"人能调哪些 API";本节管"**AI 在 AgentRun 内,某次工具调用那一刻是否放行**"。这是 PRD §8.6 + FR-PERM-001 的核心,借鉴 opencode 的**阻塞式审批原语 + 默认就问**。现有 `auto_agent.py` 只有静态沙箱(白名单/rlimit),**没有**动态分层策略——这是 WorkHub 的新增护城河。

### 5.2 PermissionPolicy 数据结构

```
PermissionPolicy:
  id            : str
  scope_type    : enum(org | workspace | role | session)   # 合并优先级低→高
  scope_id      : str                                       # 对应作用域实体 id
  tool_pattern  : str        # glob,如 "drive.write", "run_command:*", "*"
  effect        : enum(allow | deny | ask)                  # 未匹配兜底 = ask
  reason        : str|null   # 给用户看的人话(去黑话)
  created_by    : str        # 审计:谁定的规则
  expires_at    : datetime|null
```

### 5.3 合并算法(scope 优先级 + effect 强弱)

```
resolve(actor, tool, args) -> effect:
  candidates = policies matching tool_pattern(tool)
               across scopes [org, workspace, role, session]
  # 1) 作用域优先级:session > role > workspace > org(越近越优先)
  # 2) 同一作用域内 effect 强弱:deny > ask > allow(最保守者胜,fail-safe)
  best = pick by (scope_priority desc, effect_strength desc)
  return best.effect if best else ASK     # ★ 默认就问(PRD FR-PERM-001)
```

**规则表(冲突裁决)**:

| 情形 | 裁决 | 理由 |
|---|---|---|
| session 层 `allow` vs org 层 `deny` | **session allow 胜** | 越近作用域越具体(用户当场授权) |
| 同作用域 `deny` 与 `ask` 并存 | **deny 胜** | fail-safe,最保守 |
| 无任何匹配规则 | **ask** | 默认就问,绝不默认放行 |
| 高风险工具(对外/不可逆,见 §6.1) | 即便命中 allow,仍受 §6 风险门叠加 | 风险门是独立的第二道闸 |

### 5.4 工具注册表按 actor 权限过滤(模型可见性)

借鉴 opencode:**注册表按"当前 actor 权限"过滤模型可见的工具菜单**(PRD §8.1)。即模型连"看都看不到"被 deny 的工具,而非看到再被拒——减少越权尝试与提示注入面。schema 校验失败 → 回灌可恢复错误而非崩溃(现有 `auto_agent.py:490` 已是 try/except 回灌 `[error] ...` 的雏形)。

```
visible_tools(actor) = [ t for t in ALL_TOOLS
                         if resolve(actor, t.id, None) != DENY ]
# effect == ask 的工具仍可见,但 execute 时阻塞等审批(§6)
```

### 5.5 "永远允许"学习(降打扰)

PRD FR-PERM-003:用户对某 `ask` 选"永远允许"→ 沉淀为一条 `session`(或更宽)作用域的 `allow` PermissionPolicy,逐步减少打扰。撤销 = 删该 policy。所有沉淀写审计(谁、何时、对什么工具),可回溯。

---

## 6. 沙箱(Sandbox)与执行风险门

### 6.1 静态沙箱(完整继承 `auto_agent.py`,这是已验证资产)

AgentRun 的工具执行在每 WorkItem 一个 workdir 内,五道静态防线:

| 防线 | 机制 | 锚点 | 阈值/常量 |
|---|---|---|---|
| **路径前缀禁逃逸** | `_safe_path()` resolve 后校验仍在 workdir 内,否则 `ValueError: path escapes workdir` | `auto_agent.py:154` | 拒 `../`、绝对路径(prompt 也明令,`prompts/auto_agent.md:28`) |
| **命令白名单 + 无 shell** | `run_command` 仅放行 `ALLOWED_COMMANDS`;`shell=False`(argv 直传);拒 null 字节 | `auto_agent.py:288` | `{python,python3,py,node,npm,pnpm,bun,pytest,ruff,tsc}` |
| **禁装包/禁网依赖** | `npm/pnpm/bun {install,add,i}` 直接拒 | `auto_agent.py:296` | "dependency installation is disabled" |
| **rlimit 资源上限** | POSIX `preexec_fn` 在 fork 后 exec 前设 cap | `auto_agent.py:268` | CPU 120s / AS 2GiB / FSIZE 256MiB / NOFILE 512 |
| **沙箱配额** | 每次写后 `_enforce_sandbox_budget` 统计文件数/总字节 | `auto_agent.py:176` | ≤800 文件 / ≤200MiB |

环境收窄(`auto_agent.py:304`):`HOME`/`TMPDIR`/`TEMP`/`TMP` 全指向 workdir,`PYTHONPATH` 限 workdir,`NO_COLOR=1`。命令单次超时 ≤60s,输出截断 12000 字符。

**已知残余风险(LAN-only 接受,上云闭合 R2,见 §1.3)**:
- **网络 egress 不封**:`RLIMIT_NPROC` 刻意不设(per-UID,忙时会 exec 失败);egress 需 netns 才能封,LAN 模式接受(`auto_agent.py:278` 注释)。
- **Windows 开发无 rlimit**:`resource` 模块 POSIX-only,Windows 上 `_set_rlimit` 是 no-op(`auto_agent.py:22`)——生产必须 Linux。

### 6.2 预算门(硬上限,防 doom-loop / token 烧穿)

PRD §8.1 决策:**每个 AgentRun 必须有硬预算上限**。现状常量:

| 预算 | 常量 | 锚点 | 超限处置 |
|---|---|---|---|
| 最大轮次 | `MAX_TURNS=15` | `auto_agent.py:36` | 达上限返回 `"达到最大轮次未完成"`(WorkHub:转结构化交接件 + 升级,FR-WORKER-003) |
| 总超时 | `TOTAL_TIMEOUT_DEFAULT=300s` | `auto_agent.py:37` | 返回 `"总耗时超过预算"` |
| 单轮 LLM 超时 | `timeout - 已耗时`(≥30s 兜底) | `auto_agent.py:422` | `"单轮 LLM 调用超时"` |

> WorkHub 把超限从"静默失败"升级为 **doom-loop/预算耗尽 → 自动升级**(PRD §8.2 / FR-ESC-004,借鉴 opencode),并强制产出"已做/未做/下一步"交接件——详见 [`../02-ai-engine/agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md) 与 [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md)。

### 6.3 风险门(第二道闸,叠加在 §5 策略之上)

§5 管"工具是否被策略允许";风险门管"即便允许,这次副作用是否够危险到必须人工拍板"。风险维度(PRD §8.2,待业务标定)与分级裁决在 [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md) 详述;本篇只锚定**安全语义**:

| 档 | 安全处置 |
|---|---|
| 高置信 + 低风险 | 策略放行即执行,事后审计 + 快照可回滚 |
| 中风险 | 生成 Proposal 转人工抽检(快速通过/打回) |
| 高风险 / 不可逆 / 对外 / 卡住 | **审批阻塞门(ask)** 或直接升级,人工拍板前不落生产态 |

---

## 7. 按身份审计(Identity-Scoped Audit)

### 7.1 现状审计零件(WorkHub 聚合升级)

现有产品的审计是分散的、按对象的:

| 表 | 记录什么 | 锚点 |
|---|---|---|
| `ActivityLog` | WorkItem 级动作(actor_nickname / action / detail_json) | `models.py:554` |
| `ProjectDriveOperation` | 网盘操作(actor_user_id / op_type / payload + `undone_at`) | `models.py:214` |
| `RequirementProgressUpdate` | 进度流水(actor / kind / body) | `models.py:408` |
| `RevisionRequest` | 打回理由(requested_by / reason_md) | `models.py:535` |

### 7.2 WorkHub:统一 AuditLog(PRD NFR-03 / FR-PERM-004)

PRD 要求**所有 AI/人动作按身份记录,可追溯、可回滚**。WorkHub 引入统一 `AuditLog`(PRD §7),字段建议(全量与 ER 见 [`data-model.md`](./data-model.md)):

```
AuditLog:
  id            : str
  actor_kind    : enum(human | ai_worker | ai_pm | system)   # ★ 区分人/AI
  actor_id      : str        # User.id 或 AgentRun.id
  actor_label   : str        # 冗余昵称/Agent 名,防 actor 改名后失真
  org_id        : str        # 作用域(上云行级过滤,R5)
  workspace_id  : str|null
  object_type   : str        # WorkItem | Proposal | DriveItem | PermissionPolicy ...
  object_id     : str
  action        : str        # create | update | merge | approve | reject | tool_call ...
  before_ref    : str|null   # 快照引用(§8),回滚依据
  after_ref     : str|null
  reason        : str|null   # 打回/审批理由,回灌 AI 的上下文
  request_id    : str|null   # 关联一次请求/AgentRun trace
  created_at    : datetime
```

**关键设计**:`actor_kind` 让"AI 干的"与"人干的"在审计上一等可分(PRD 北极星度量"自治率"依赖它);`actor_label` 冗余存储,因为 `User.nickname` 可被复用(re-register 后会变,`models.py:31` 注释),审计必须冻结当时身份。

### 7.3 审计模板注入防护(已踩过的坑,务必延续)

`lifecycle.py:124` 的血泪教训:渲染通知/审计文本**用 `str.replace` 而非 `str.format`**——否则攻击者把昵称设成 `{actor.__class__}` 会触发 `KeyError` 或属性泄漏。WorkHub 所有"把用户可控字符串塞进模板"的地方一律 `replace`,且昵称在 §2.3 已拒控制字符。

### 7.4 私有事件按身份隔离(NFR-08)

SSE/WS 事件流(`require_stream_user`,`auth.py:202`)是跨用户泄漏高危面。WorkHub 红线:**私有 topic(如 `req:<id>`、`user:<id>`)订阅前必须校验该 StreamUser 对该对象的 `can_view_*` 权限**,防止订阅他人 topic 偷看进度。事件载荷不夹带越权字段。事件类型清单见 [`api-contract.md`](./api-contract.md)。

---

## 8. AI 副作用快照回滚红线(Snapshot & Rollback)

### 8.1 红线条款(PRD §5.5 / NFR-04 / FR-WORKER-004 / D-6)

> **AI 对业务数据的每一次副作用,执行前必须生成可恢复快照;任何步骤可 revert。** 这是 WorkHub 的安全宪法级约束,借鉴 opencode 的"每步 git 快照"。

### 8.2 现有可回滚锚点(地基,WorkHub 泛化)

| 机制 | 现状 | 锚点 |
|---|---|---|
| 网盘操作可撤销 | `ProjectDriveOperation.undone_at` | `models.py:222` |
| 文件版本化 | `ProjectDriveVersion.version_no` + `sha256`(append-only) | `models.py:192` |
| 交付按轮次版本 | `Delivery.round` 唯一约束 | `models.py:515` |
| 软删除而非硬删 | `deleted_at` 遍布(User/Project/DriveItem…) | `models.py:43/85/180` |

### 8.3 快照机制(WorkHub 新增,接口级)

WorkHub 把"每步快照"做成 AgentRun 的一等机制:

```
SideEffectSnapshot:
  id            : str
  agent_run_id  : str        # 归属哪次 AgentRun
  step_no       : int        # AgentRun 内步序(对齐 trace)
  object_type   : str
  object_id     : str
  before_state  : ref        # 业务对象快照(结构化记录 = 行快照/JSON;文档 = 内容 blob + sha256)
  created_at    : datetime
  reverted_at   : datetime|null
```

**算法(每次 AI 副作用包裹)**:
```
with side_effect(agent_run, step_no, object):
    snap = capture_before(object)        # 1) 先存前态(沿用 sha256 去重)
    AuditLog.before_ref = snap.id        # 2) 审计挂钩
    do_mutation()                        # 3) 真改
    AuditLog.after_ref = capture_after() # 4) 存后态
revert(snap):                            # 任意步可逆
    restore(object, snap.before_state)
    snap.reverted_at = now()
    AuditLog(action="revert", before_ref=after, after_ref=snap.id)
```

**边界与失败处理**:
- **快照失败 = 不执行**:`capture_before` 失败则该副作用**拒绝执行**(fail-closed,红线不可降级)。
- **D-2 事务原子性**:PostgreSQL 下,快照写入与业务变更**同事务**;commit 回滚则快照与变更一起回滚。范式对齐现有"先入库、commit 后才发副作用"分离:`queue_status_notifications`(`lifecycle.py:104`,在事务内攒 Notification 行、**不** commit/publish)+ `flush_status_notifications`(`lifecycle.py:164`,在 `db.commit()` **之后**才推 SSE,见 docstring `:114`)——SSE 永不先于落库。这也呼应近期 commit 修的"finalize 提交回滚时清理孤儿 blob"(git log `75dacff`)——快照系统必须同样防孤儿。
- **沙箱产物 vs 业务态**:沙箱 workdir 是临时执行区(`auto_process` 起始 `shutil.rmtree` 重建,`auto_agent.py:634`),不是生产态;只有当产物经分级→Proposal→合并 main 时才触发业务副作用与快照。沙箱内的写不需逐个业务快照(它整体可丢弃)。
- **合并入 main 是受审批的副作用**:Proposal 合并本身是一次 AI/人副作用,落 AuditLog(`action=merge`)+ 快照,可整体回滚(去黑话呈现为"撤销采纳",见 [`../03-collaboration/branch-proposal-merge.md`](../03-collaboration/branch-proposal-merge.md))。

---

## 9. 失败处理与安全默认值汇总

| 场景 | 默认行为 | fail 方向 |
|---|---|---|
| 认证缺失/签名错 | 401 / `_verify` 返回 None | fail-closed |
| 设备门未过 | 403 "local client required" | fail-closed |
| 新设备认领 admin 且 secret 空 | 403 拒绝 | fail-closed |
| 权限策略无匹配 | **ask**(默认就问) | fail-safe(不默认放行) |
| 同作用域 deny/ask 冲突 | deny 胜 | fail-safe |
| 路径逃逸 / 非白名单命令 | 工具返回 `[error]` 并回灌(不崩) | 可恢复 |
| 预算/超时耗尽 | 结构化交接件 + 升级(不静默截断) | 优雅降级 |
| 快照捕获失败 | 拒绝执行该副作用 | fail-closed(红线) |
| SSE 私有 topic 越权订阅 | 拒订阅 | fail-closed |
| 生产配置弱(默认 cookie_secret / CORS=*) | 启动即 `RuntimeError` 拒启 | fail-closed(`main.py:227`) |

---

## 10. 与其他文档的交叉引用

- 实体/字段/状态机全量、AuditLog/PermissionPolicy/SideEffectSnapshot 的 ER → [`data-model.md`](./data-model.md)
- 路由、鉴权中间件、事件类型清单 → [`api-contract.md`](./api-contract.md)
- daemon/clients 进程边界、SSE/WS 拓扑、部署形态 → [`system-architecture.md`](./system-architecture.md)
- 选型与现状→新仓迁移、复用零件映射 → [`tech-stack-and-migration.md`](./tech-stack-and-migration.md)
- 工具循环/控制信号/doom-loop → [`../02-ai-engine/agent-loop-and-tools.md`](../02-ai-engine/agent-loop-and-tools.md)
- 置信度/风险维度/分级阈值/三触发器/打回回灌 → [`../02-ai-engine/confidence-risk-escalation.md`](../02-ai-engine/confidence-risk-escalation.md)
- 审批阻塞原语/路由/SLA/委派/"永远允许"学习 → [`../03-collaboration/review-and-approval.md`](../03-collaboration/review-and-approval.md)
- 去黑话用户用语映射(撤销采纳/撞车了等)→ [`../00-overview/glossary-dejargon.md`](../00-overview/glossary-dejargon.md)
