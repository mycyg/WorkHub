---
module: R5-permission-matrix-audit
layer: P-PERM / API / QA
status: completed
owner: workflow
date: 2026-06-12
depends_on:
  - s1-pilot-readiness-roadmap-2026-06-12.md
  - ../01-architecture/security-and-permissions.md
  - r4-mid-review-upgrade-audit-2026-06-11.md
---

# R5.12 权限矩阵审计 Plan（S1 第四刀，关闭中期审查 P1-4）

## 1. 背景

中期审查 P1-4：资源读权限是各路由手写检查，`@workhub/permissions` 策略引擎只接在 approvals；写路径是否全部过"分层 permission + 风险门"从未系统对账。多用户同实例（pilot 形态）前必须收口。

## 2. 目标

| # | 必须完成 | 边界 |
|---|---|---|
| A1 | **路由全量清点**：程序化枚举全部已注册 API 路由（method × path），逐条登记：鉴权中间件、资源级检查、admin 边界、角色判定来源——产出"角色 × 路由"审计表（落 `01-architecture/security-and-permissions.md` 附录或本篇 §4） | 以代码为准，不以文档自述为准 |
| A2 | **自动化 fail-closed 门**：新增 api 测试——遍历 app 全部路由，除显式公开白名单（`/`、`/api/health`、`/openapi.json`、`/api/auth/identify`、`/api/auth/me`、SSE QA hook 等）外，未鉴权请求必须 401/403；**该测试常驻**，新路由漏鉴权 CI 即红 | 公开白名单显式列出并说明理由 |
| A3 | **写路径收口**：对审计表中发现的洞逐个修（资源级检查缺失、普通用户可触 admin 面、跨用户数据可读等），每个洞配回归测试 | 不重写 permission 引擎；判定语义沿用 §4.3/§4.4（admin 读写不对称保留） |
| A4 | 文档回写：审计表 + 修复清单 + 残余风险（接受项）登记 | — |

## 3. QA Gate

- 新增 fail-closed 路由测试全绿且覆盖全部注册路由；
- 每个修复洞的回归测试；
- `pnpm typecheck`/`test`/`lint`、browser smoke 70 步、`pilot-stack-smoke`（未鉴权 fail-closed 段已在）、release gate。

## 4. 审计结果（A1）与修复（A3）

**路由全清点（79 条已注册路由，程序化枚举 `app.routes`）**：未鉴权探测显示**所有业务路由已 401 fail-closed**，无未鉴权泄漏。公开路由仅 7 条且均无用户数据：`GET /`、`/api/health`、`/openapi.json`（×2）、`POST /api/auth/identify`、`GET /api/auth/me`（未识别返回 null）、`GET /api/pages/gold-path`（demo fixture）。

**已鉴权深度核查发现并修复 2 个真实洞**：

| # | 洞 | 严重度 | 修复 | 回归测试 |
|---|---|---|---|---|
| H1 | `GET /api/workitems/:id/audit` 无资源级检查——任意已登录用户可凭 ID 读他人 WorkItem 的完整审计轨迹与快照（跨用户数据泄漏） | 高 | 复用 `workItems.detailPage` 资源门（admin 读全量 §4.4 / 普通用户关系+活跃过滤）；不可见即 403 | audit.test：不可见→403、admin→200 |
| H2 | `/api/permissions` 策略读对所有用户开放、写仅设备门无 admin——普通用户可读/改 org 级 allow/deny/ask 治理策略（治理面越权） | 高 | 读写均加 `requireAdmin`（§4.2 admin 治理角色/策略/配额）；设备门保留叠加 | approvals.test：非 admin 读→403、admin 读→200、写设备门保留 |

**A2 常驻门**：新增 `apps/api/src/route-auth-posture.test.ts`——遍历全部注册路由，白名单外未鉴权必 401/403，且白名单不得含已不存在的路由。新路由漏鉴权 CI 即红。

## 5. Handoff

R5.12 完成 = **系统 pilot-ready**。剩余两件事均为外部输入：`LLM_API_KEY`（开 R5.10 评估）与试运行人员（开 S1 Pilot Week）。
