---
component: F04
title: 鉴权 / 身份移植（Auth / Identity Port）系统级实现 plan
status: active
depends: [F2]
type: feat
date: 2026-06-05
master: ../2026-06-05-feat-workhub-p0-foundation-master-plan.md
inventory: ./_migration-inventory.md
spec: ../../workhub/01-architecture/security-and-permissions.md
---

# F04 鉴权 / 身份移植 —— 系统级实现 plan

> 把现有「需求管理大师」的**双通道鉴权(cookie + 设备令牌)优先级链**与**设备令牌门**逐字移植到 WorkHub headless daemon,补齐 **AI actor 一等身份**与 **Org/Workspace 上下文注入**,并在 PG/多 worker 形态下放宽 SQLite 单写锁 hack。
> **铁律 §6.4(安全敏感逐字移植)是本组件的最高约束**:`auth.py` 的 token-胜-cookie 优先级链是一段已修复的真实 outage(`auth.py:68-75/109-111`),**禁止「顺手重构」**。本 plan 的所有 REFACTOR 都是**加法**(新增 DI、新增上下文),不改既有解析顺序与边界条件。

来源:对现有代码逐一核验。锚点形如 `file:line`,均经实际读取确认(`app/auth.py`、`app/routers/auth.py`、`app/models.py`、`app/routers/auto.py`、`app/routers/push.py`、`app/config.py`、`app/main.py`)。

---

## 目标

1. 把整套**双通道鉴权**(签名 cookie + 设备令牌)的**优先级链**逐字移植:设备令牌优先于 cookie,均带 `deleted_at IS NULL`,软删即不存在(`auth.py:104-127`)。
2. 把**设备令牌门**三档守卫(硬门 `require_local_client` / 软门 `optional_local_client` / `current_client_device`)与 `require_stream_user`(不持 DB session)逐字移植(`auth.py:172-226`)。
3. 把 **admin-claim 二次门**(常数时间 `compare_digest`、新设备认领 admin 须 secret)逐字移植(`routers/auth.py:69-81`)。
4. 把 **AI 合成 actor** 从临时伪造的 `User(id="ai-auto")`(`routers/auto.py:224`)升级为**一等身份**:稳定 `actor_kind`、可被审计/权限/事件按身份消费,且**永不通过认证路径登录**。
5. 在 daemon 边界注入 **Org/Workspace 上下文**(P0 单 Org,字段就位、查询谓词预留),为 F6 权限引擎与上云行级过滤(R5)铺路。
6. PG 形态下放宽 `_user_from_worker_token` 不写 `last_seen_at` 的 SQLite hack(`auth.py:94-100`)——行级锁≠全库锁。

**北极星不变式**(任何改动后回归必须仍成立):
- 有效设备令牌**赢过** cookie(`auth.py:109-111`);
- 软删用户即使持有效 cookie 也 401(`auth.py:116-118`);
- admin **不豁免**设备门(spec §3.2;`permissions.py` docstring);
- 新设备认领 admin、secret 为空 ⇒ 403 拒绝(`routers/auth.py:77`);
- AI actor 的 id 不匹配任何真实 user,故通知把提交者正确算作收件人(`routers/auto.py:221-225`)。

## 范围(Scope)

### In(P0 必须)
- `auth.py` 全量移植到 WorkHub daemon 包结构(双通道链、三档设备门、`require_stream_user`、cookie 签发/轮换、令牌哈希/吊销)。
- `routers/auth.py` 全量移植(`identify` + admin-claim 门、`_validate_nickname`、`me`、`logout`)。
- `make_client_token`(48B)/`hash_client_token`(sha256,永不明文入库)/`issue_cookie`(itsdangerous)逐字移植(`auth.py:33-55`)。
- 新增 `require_actor` DI:统一返回「人 actor 或 AI actor」的一等 `Actor` 抽象;AI actor 不经认证。
- Org/Workspace 上下文注入:`current_user` 之上派生 `org_id`/`workspace_id`,挂到请求级 `AuthContext`。
- PG 下放开 `_user_from_worker_token` 的 `last_seen_at` 更新(可配置开关,默认开)。
- 生产门 `_validate_runtime_config`(`main.py:227-233`)中**鉴权相关项**的延续(cookie_secret / cookie_secure / admin_claim_secret),与 F1/F11 协同。
- 回归测试覆盖上列全部不变式。

### Out(明确推迟到 P1+)
- **RBAC 角色矩阵 / 分层 allow-deny-ask 策略引擎**(spec §4–§5)→ **F6**(本组件只提供 actor 与 scope 上下文,不做 policy 解析)。
- **真实凭据**(密码 / OIDC / SSO 替换裸昵称,R1)→ **P5**(LAN-first 继续昵称即身份)。
- **沙箱网络 egress 封锁**(R2)、强制 HTTPS/HSTS(R4)、RLS 行级安全(R5)→ 上云阶段。
- **统一 AuditLog / 快照回滚**(spec §7.2/§8)→ **F10**(本组件只保证 actor 一等可分,供 F10 写 `actor_kind/actor_label`)。
- **跨域 CORS + cookie SameSite/secure 重解**(web 解耦后同源假设失效)→ **F11**(本组件保持 cookie 签发逻辑不变,F11 负责跨域门)。
- **事件 topic 鉴权门的 broker 化重强制**(NFR-08)→ **F5**(本组件只移植 `require_stream_user` 与订阅前 `can_view` 门的**现状形态**,broker 边界重强制归 F5)。

## 现状 → 改动

> 分组:**PORT(逐字移植,禁改语义)** / **REFACTOR(加法式增强,不动既有顺序)** / **NEW(净新)**。每条带 `file:line` 锚点。

### PORT —— 逐字移植(安全敏感,禁止重写,Master §6.4)

- **P1 双通道优先级链 `current_user`**(`auth.py:104-127`):①取 `X-YQGL-Client-Token` → `_user_from_worker_token`(`auth.py:67-101`)命中即返回(**token 胜 cookie**);②否则 `_verify` 签名 cookie → 查 `User WHERE cookie_token=token AND deleted_at IS NULL`;③都失败 401。**顺序、`deleted_at IS NULL`、`touch_user` 调用位置一字不改。**
- **P2 `optional_current_user`**(`auth.py:130-147`):同链但失败返回 `None`(供 `identify` 判「调用者是否已是本人」)。
- **P3 worker-token 解析 `_user_from_worker_token`**(`auth.py:67-101`):查 `ClientDevice WHERE token_hash=sha256(t) AND revoked_at IS NULL` → 查 `User … deleted_at IS NULL`。注释里的 outage 史(`auth.py:68-75`)随码移植,**勿删**。
- **P4 设备门三档**:
  - 硬门 `current_client_device`(`auth.py:172-180`)/ `require_local_client`(`auth.py:183-186`):无 / 无效 token → 403 "local client required";命中即时 commit `last_seen_at`(`_lookup_client_device:150-169`)。
  - 软门 `optional_local_client`(`auth.py:189-199`):无 token 放行 `None`;有 token 但无效 → 403。**软/硬差异是已踩实语义,禁抹平**(spec §3.3)。
- **P5 `require_stream_user`**(`auth.py:202-226`):长连接用,**不跨响应持 DB session**(开 `SessionLocal` 查完即 `close()`);接受 cookie 或 token;返回轻量 `StreamUser(id, nickname)`(`auth.py:27-31`)。
- **P6 令牌/cookie 原语**:`make_client_token`(48B,`auth.py:37-38`)、`hash_client_token`(sha256,`auth.py:41-42`,**永不存明文**)、`issue_cookie`(itsdangerous 签名 + `httponly/samesite=lax/secure=settings.cookie_secure`,`auth.py:45-55`)、`_verify`(`BadSignature → None`,`auth.py:58-64`)。
- **P7 cookie/令牌失效**:`forget_user_cookie`(轮换 `cookie_token` 使在外 cookie 立即失效,`auth.py:249-253`)、`forget_presented_client_token`(**按呈现的令牌而非 cookie 用户**吊销,`auth.py:256-275`)、`forget_client_token`(兼容旧调用点,委派 presented,`auth.py:278-285`)。
- **P8 admin-claim 门**(`routers/auth.py:69-81`):`if user.is_admin and (current is None or current.id != user.id)` → 须 `secrets.compare_digest(admin_secret, settings.admin_claim_secret)`;secret 空 ⇒ 一律 403。**常数时间比较防计时侧信道,逐字保留。**
- **P9 `_validate_nickname`**(`routers/auth.py:30-44`):拒 `_deleted_` 前缀(防伪装已删账号)、拒控制字符 `\r\n\t\x00`,UTF-8 中文/emoji 放行。
- **P10 `get_or_create_user`**(`auth.py:229-246`):昵称复用活账号、软删账号视为不存在不可自助复活。`logout`(`routers/auth.py:104-118`)轮换 cookie + 吊销呈现令牌 + 清 presence。
- **P11 带外 admin 授予**:`scripts/set_admin.py`(`grant()` + `YQGL_BOOTSTRAP_NICKNAMES`)随仓移植;**无自助提权 API** 这一红线保留(spec §2.4)。

### REFACTOR —— 加法式增强(不改既有解析顺序)

- **R1 PG 放开 `last_seen_at` hack**(`auth.py:94-100`):SQLite 单写锁约束消失后,`_user_from_worker_token` 可安全更新 `device.last_seen_at`(行级锁)。实现为 `settings.touch_device_on_auth`(默认 `True`),**保留** in-memory `touch_user` presence 不变;注释史保留并加 "D-2 放宽" 备注(spec §2.2)。
- **R2 注入 Org/Workspace 上下文**:新增请求级 `AuthContext{user|actor, org_id, workspace_id}`,由 `current_user` 之上的 `current_context` DI 派生(P0 单 Org → 常量/默认 workspace;字段就位、查询谓词预留)。**不改 `current_user` 签名**,新 DI 叠加。
- **R3 `is_admin` 定位收敛**:`is_admin`(`models.py:38`)在 F4 内**仅作身份标志**移植,不在此组件做「最高优先 allow-fallback」——该语义属 **F6**。F4 仅保证 `Actor.is_admin` 可被 F6 读取,且**设备门正交于 admin**(admin 不豁免)的不变式随码移植。
- **R4 包结构与导入路径**:`from config import settings` / `from db import …` / `from models import …` 等扁平导入随 F1 daemon 包重组调整为 WorkHub 包路径;**逻辑零改**,仅 import。
- **R5 `datetime.utcnow()` → timezone-aware**:`auth.py:167/272`(`_lookup_client_device`、`forget_presented_client_token` 写 `last_seen_at/revoked_at`)的 naive `utcnow()` 随 F3 时间审校统一为 `timestamptz`(`now(tz=UTC)`)。**仅时间类型,不改吊销/活跃语义。**

### NEW —— 净新

- **N1 AI actor 一等身份**:定义 `Actor` 抽象(`kind ∈ {human, ai, system}`——**与 data-model §8.3 `AuditLog.actor_kind` / §6.1 `Branch.actor_kind` / api-contract §3.3 持久化 `actor_kind` 单一真相对齐,只此三档**;worker/pm 的细分由 `AgentRun.mode`(data-model §7.1)与 `AgentRun.actor` 串(如 `ai:worker`/`ai:pm`)承载,**不混入 `actor_kind`**),字段 `id`, `label`, `is_admin`, `org_id`, `workspace_id`。AI actor:
  - **不经认证路径**(不查 `users` 表,不签 cookie,不持设备令牌);由 daemon 在发起 AgentRun 时构造,`id` 稳定派生(如 `ai:{agent_run_id}` 或 `ai:auto`),`label = "AI ({model})"`。
  - 替换 `routers/auto.py:224` 的临时 `User(id="ai-auto", nickname=…)`;**保留**「id 不匹配真实 user ⇒ 提交者被正确算作收件人」的行为(`routers/auto.py:221-225`),通过让通知/lifecycle 接受 `Actor` 而非裸 `User`。
- **N2 `require_actor` DI**:统一出口,返回 `Actor`——人请求路径包装 `current_user`;AI/system 路径由调用方注入。供 F6(权限按 actor)、F8(AgentRun 持有 actor)、F10(审计 `actor_kind/actor_label`)消费。
- **N3 Org/Workspace 实体上下文挂载点**:与 F2 新增 `Org/Workspace` 实体对接,F4 提供「从 user → 默认 org/workspace」的解析函数(P0 单 Org 返回默认;字段与 DI 就位)。
- **N4 鉴权配置块**:F1 config 中新增 `touch_device_on_auth: bool = True`、Org/Workspace 默认 id;`admin_claim_secret`/`cookie_secret`/`cookie_secure` 延续。

## 实施步骤(有序可勾选)

- [ ] **S1**（依赖 F2 完成 `User`/`ClientDevice` + 新 `Org`/`Workspace` 实体)逐字复制 `app/auth.py` 到 WorkHub daemon 包,仅改 import 路径(R4),逻辑零改。运行既有调用方编译通过。
- [ ] **S2** 逐字复制 `app/routers/auth.py`(`identify`/`me`/`logout`/`_validate_nickname`/admin-claim 门)。
- [ ] **S3** 复制 `scripts/set_admin.py` 带外授予路径 + `YQGL_BOOTSTRAP_NICKNAMES`(P11)。
- [ ] **S4** 写**不变式回归测试**(见验收用例 T1–T9),先跑通=移植无回归基线。**此步是后续重构的安全网,必须先于 R*/N*。**
- [ ] **S5**（R5）`auth.py` 内 `datetime.utcnow()` → tz-aware(随 F3),回归 T 全绿。
- [ ] **S6**（R1）加 `settings.touch_device_on_auth`,PG 下放开 `_user_from_worker_token` 写 `last_seen_at`;并发回归(2 worker 下无 `database is locked`、`last_seen_at` 单调更新)。
- [ ] **S7**（N1/N2）定义 `Actor` 抽象 + `require_actor` DI;让 lifecycle/notifications 接受 `Actor`;替换 `routers/auto.py:224` 的 `User(id="ai-auto")`。回归 T8(AI 提交通知收件人不变)。
- [ ] **S8**（R2/N3/N4）加 `AuthContext` + `current_context` DI + Org/Workspace 默认解析 + 配置块;`current_user` 签名不变,新 DI 叠加。
- [ ] **S9** 把 `require_stream_user` 与 push 路由的「订阅前 `can_view` 门」(`push.py:84-85`)按 `Actor`/`AuthContext` 适配——**仅适配,broker 边界重强制留给 F5**(在此标注 handoff)。
- [ ] **S10** 生产门(`main.py:227-233`)鉴权相关校验项随 F1/F11 落位:cookie_secret 非默认、production 下 `cookie_secure=True` 建议项、`admin_claim_secret` 行为说明。
- [ ] **S11** 全量回归 + 与 F6 联调点冒烟(F6 读 `Actor.is_admin`/scope)。

## 数据与接口契约

> 跨组件共享处以 **Master §6 + spec** 为准;本组件**不新建**权限/审计表(归 F6/F10),只消费 F2 的身份实体。

### 实体字段(F2 owns schema;此处为 F4 依赖契约)
- `User`(`models.py:27`):`id`(F3 后 `String(32)`→PG `UUID`)、`nickname`(unique)、`cookie_token`(unique,明文存服务端、cookie 内是签名值)、`is_admin`(`boolean DEFAULT false`)、`deleted_at`(软删,`timestamptz`)。**F4 依赖 `deleted_at IS NULL` 谓词与 `cookie_token` 唯一索引。**
- `ClientDevice`(`models.py:57`):`client_token_hash`(sha256,**unique 索引,永不存明文**)、`user_id`(FK)、`revoked_at`、`last_seen_at`、`platform`。
- **F4 → F2 新增需求**:`Org`/`Workspace` 实体(供 N3 上下文);P0 单 Org,字段就位。**不**给 `User` 加密码列(R1 推迟 P5)。

### Alembic(F3 owns;F4 关联项)
- 无 F4 专属迁移。F4 依赖 F3 把 `is_admin BOOLEAN DEFAULT 0`→`boolean DEFAULT false`、`utcnow()` 时间列→`timestamptz`、`String(32)` id→`UUID`。R1 的 `last_seen_at` 高频更新建议 F3 评估是否需独立索引/HOT update(性能,非正确性)。

### API(逐字移植,签名不变)
| 端点 | 守卫 | 契约要点 | 锚点 |
|---|---|---|---|
| `POST /api/auth/identify` | `optional_current_user` | admin 昵称在新设备须 `admin_secret`;返回 `{id,nickname,created,is_admin,…}` | `routers/auth.py:56-89` |
| `GET /api/auth/me` | `optional_current_user` | 无身份返回 `null`;`display_name` 去 tombstone 前缀 | `routers/auth.py:92-101` |
| `POST /api/auth/logout` | `current_user` | 轮换 cookie + 吊销**呈现的**令牌 + 清 presence | `routers/auth.py:104-118` |
| `POST /api/client-devices/register` | `current_user` | 48B 令牌,DB 存 sha256,**明文仅返回一次** | spec §3.4;`routers/client_devices.py` |
| `POST /api/client-devices/{id}/revoke` · `revoke-current` | `current_user` / `current_client_device` | 置 `revoked_at`,解析立即失败 | spec §3.4 |

**设备门覆盖现状(WorkHub 演进基线,禁抹平硬/软)**:`sync.py` 硬门、`delivery_upload.py` 硬门、`workspaces.py` 硬门、`decompositions.py` **软门**、`requirements.py` 部分**软门**、`push.py` `require_stream_user`(spec §3.3)。

### 事件 topic(F5 owns taxonomy;F4 关联项)
- `require_stream_user` + 订阅前 `can_view` 门是 `user:{id}`/`req:{id}` 私有 topic 的鉴权边界(`push.py:64-92`,spec §7.4)。**F4 保证 `StreamUser`/`Actor` 由身份派生(非路径);broker 化后订阅边界重强制归 F5。**
- N1 的 AI actor `id` 进入审计/事件后,F10 据 `actor_kind` 区分「AI 干的 vs 人干的」(spec §7.2)。

## 验收用例(可测)

> 全部为**不变式回归**,移植后 + 重构后均须绿(对应 S4 安全网)。

- [ ] **T1 token 胜 cookie**:同请求带「有效设备令牌 A(属 user U_a)」+「有效 cookie(属 user U_b)」→ `current_user` 返回 **U_a**(`auth.py:109-111`)。
- [ ] **T2 软删即 401**:user 持有效 cookie,管理员软删该 user(`deleted_at` 置位)→ 下次请求 401 "not identified"(`auth.py:116-118`)。
- [ ] **T3 设备硬门**:`require_local_client` 路由,无令牌 → 403;无效/已吊销令牌 → 403;有效令牌 → 放行且 `last_seen_at` 更新(`auth.py:172-186`)。
- [ ] **T4 设备软门**:`optional_local_client`,无令牌 → 放行(`None`);呈现无效令牌 → 403(`auth.py:189-199`)。
- [ ] **T5 admin-claim**:admin 昵称 + 新设备(无 cookie/token):secret 空 → 403;secret 非空但不匹配 → 403;匹配 → 登录;**admin 本人**(带本人 cookie)无 secret → 登录(`routers/auth.py:74-81`)。
- [ ] **T6 admin 不豁免设备门**:admin 用户访问硬门路由但无设备令牌 → 403(spec §3.2)。
- [ ] **T7 昵称校验**:`_deleted_x` 前缀 → 400;含 `\n` → 400;中文/emoji → 通过(`routers/auth.py:37-43`)。
- [ ] **T8 AI actor 不污染收件人**:AI 提交交付物,actor.id 不匹配任何真实 user → 提交者仍被算作通知收件人(`routers/auto.py:221-225`),且审计 `actor_kind=ai`(worker/pm 细分见 `AgentRun.mode`/`actor` 串,不入 `actor_kind`)。
- [ ] **T9 logout 按令牌吊销**:请求带 user U 的 cookie + 设备令牌 D(D 属 U)→ logout 轮换 U 的 cookie_token + 吊销 D;旧 cookie 立即失效,D 解析立即失败(`routers/auth.py:111-117`)。
- [ ] **T10（R1,PG/多 worker）**:2 worker 下并发认证 + 业务写,无 `database is locked` 类锁错;`last_seen_at` 随认证更新且无丢失(替代 SQLite hack 后的回归)。
- [ ] **T11 `require_stream_user` 无 session 泄漏**:SSE 长连接建立后,鉴权用的 `SessionLocal` 已 `close()`,流生成器不持 DB 资源(`auth.py:211-226`)。
- [ ] **T12 私有流订阅门**:订阅他人 draft/clarifying `req:{id}` → 403(`push.py:84-85`)。

## 回滚与风险

**回滚**:F4 是加法式移植。出问题分层回退——
1. N1/N2(AI actor / `require_actor`)可独立回退到 `User(id="ai-auto")` 临时形态(`routers/auto.py:224`),不影响人鉴权链。
2. R1(`last_seen_at` 放开)有 `settings.touch_device_on_auth` 开关,置 `False` 即回到「不写」的 SQLite hack 等价行为。
3. R2/N3(Org/Workspace 上下文)为旁路 DI,P0 单 Org 下移除不影响认证。
- **不可回退项**:PORT 段(P1–P11)是地基,一旦 F6/F8/F11 依赖即不可摘除。

**风险**:
1. **优先级链被「干净重写」破坏**(Master Top #4 同源,本组件首要风险):token-胜-cookie 专为 Tauri WebView2 cookie jar 与 Rust reqwest jar 分离而设(`auth.py:68-75`),是已修复 outage。→ **逐字移植 + T1/T2 回归门**;PR 评审强制 diff 比对 `current_user` 字节级一致。
2. **R1 放开 `last_seen_at` 在多 worker 下引入热行竞争**:高频认证写同一 device 行。→ 行级锁验证(T10);必要时降级为周期性批量 touch(留 F5/F8 节奏)。
3. **N1 AI actor 误入认证路径**:若 AI actor 被错误地塞进 `current_user`/cookie 路径,会绕过设备门或污染身份。→ `Actor` 抽象与 `User` 分型;`require_actor` 对 AI 路径**不查 users 表**;单测断言 AI actor 无 cookie/无设备令牌。
4. **设备门硬/软被抹平**:重构中误把软门统一为硬门(或反之)会破坏「浏览器可派活、桌面才干活」红线。→ T3/T4 双向回归 + spec §3.3 覆盖表逐路由核对。
5. **跨域 cookie 边界提前在 F4 改动**:web 解耦后 `SameSite/secure` 须重解,但**属 F11**;F4 若提前动 `issue_cookie` 会与 F11 冲突。→ F4 `issue_cookie` 保持现状(`secure=settings.cookie_secure`),跨域门 handoff F11。
6. **`admin_claim_secret` 空的语义被误改**:空 ⇒ 新设备认领 admin 一律拒(`config.py:14-20`),是 fail-closed 红线。→ T5 覆盖空/不匹配/匹配三态。

## 依赖与被依赖

**依赖**:
- **F2**(实体模型):`User`/`ClientDevice` 移植 + 新增 `Org`/`Workspace`;F4 依赖 `deleted_at IS NULL`、`cookie_token` 唯一、`client_token_hash` 唯一索引。
- **F1**(配置)隐含:`cookie_secret`/`cookie_secure`/`admin_claim_secret`/新增 `touch_device_on_auth` 经 `settings`。
- **F3**(PG/Alembic)对 R1/R5 生效是前提(行级锁、`timestamptz`);F4 的 PORT 段不阻塞于 F3(可先在 PG 上跑移植件,R1 后启用)。

**被依赖**:
- **F6 权限引擎**:消费 `Actor`(含 `is_admin`、`org_id`/`workspace_id` scope);F4 提供身份与上下文,F6 做 policy 解析与 RBAC。**admin 读/写不对称、设备门正交于 admin** 的不变式由 F4 移植、F6 不得放松(Master Top #4)。
- **F5 事件 broker**:消费 `require_stream_user`/`StreamUser`-by-identity 与订阅前 `can_view` 门;broker 化后订阅边界重强制(NFR-08)。
- **F8 Agent 引擎**:每个 AgentRun 持有一个 N1 的 AI `Actor`;`require_actor` 是工具执行权限的身份入口。
- **F10 审计/快照**:据 `actor_kind`/`actor_label` 区分人/AI 并冻结当时身份(`actor_label` 冗余,防改名失真)。
- **F11 daemon 拆分/客户端改接**:跨域 CORS + cookie `SameSite/secure` 重解、生产门不被削弱,基于 F4 的 cookie 签发与设备令牌不变式。
