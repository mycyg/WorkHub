# WorkHub

> **业务版 GitHub × AI-native 工作中台。AI 是默认劳动力,人是审批者与异常处理者。**

WorkHub 让团队里"绝大多数事"由 AI 默认完成,人只在 AI **做不好 / 做不了 / 不该做**时介入;无论 AI 还是人的改动,都经「提议 → 审批 → 合并」汇入单一可信源(main)。

- **AI 一人两顶帽子**:默认是产出交付物的「工人」;受阻(不合格 / 用户不满意 / 用户禁止)时化身「项目经理」组织人推进。
- **去 git 黑话的协作**:协作者各有"工作副本",AI 拟好改动 → 负责人确认 → 采纳;用户看不到 merge / 分支 / 冲突。
- **入口**:桌面宠物 + Web,Agent 几乎能操作所有功能,让小白也能顺畅使用。

## 现状:R4 Web 产品化收尾完成，R5 Drive 纵切准备开工 🚧

本仓库目前是 **产品规格文档树 + TS-first WorkHub 实现**。R4 Web runtime 已完成收尾门，下一条业务纵切拍板为 M-DRIVE。

- 📐 **规格树索引**:[`docs/workhub/`](docs/workhub/README.md) —— 117 篇(架构 / AI 引擎 / 协作 / 业务模块 / 客户端 / 路线图 / 成本治理 / 视觉 QA)
- 📋 **PRD(总纲)**:[`docs/prd/2026-06-04-workhub-prd.md`](docs/prd/2026-06-04-workhub-prd.md)
- 💡 **缘起(头脑风暴)**:[`docs/brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md`](docs/brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md)

**技术方向**:headless agent daemon + OpenAPI/SSE + PostgreSQL + Tauri 桌面端 / Web 瘦客户端(LAN-first,云就绪)。

### 最近里程碑

| 阶段 | 状态 | 说明 |
|---|---|---|
| R4.20-R4.21 | ✅ | app-level SSE、Page VM local refetch、Last-Event-ID/cursor、fixture chrome 退役与 shared web runtime 已落。 |
| R4.22-R4.23 | ✅ | Proposal structured field scalar 与 text hunk line editor 已成为真实可见 React mutation islands。 |
| R4.24 | ✅ | hash route 写入清理、README 状态治理、browser smoke CI 拆分计划与 R5.1 Drive 决策已落。 |
| R5.1 | planned | 下一步从 M-DRIVE 做第一条业务产品纵切，承接 accepted deliverables、Drive versions、preview/restore 与 OQ-4。 |

## 本地开发

```bash
corepack enable
pnpm install
pnpm verify
pnpm dev
```

- API daemon 默认端口: `8787` (`GET /api/health`)。
- Web SPA 规划端口: `5173`。
- Tauri webview 规划端口: `1420`。
- 默认配置来自 [`packages/config`](packages/config);复制 [`.env.example`](.env.example) 到 `.env` 后填入本地密钥。
- PostgreSQL/Redis 可用 `docker compose up -d postgres redis` 启动;Drizzle 迁移命令为 `pnpm db:generate`、`pnpm db:check`、`pnpm db:migrate`。后续数据库验收优先本地构建/本地 PG+Redis 复跑。
- 生产沙箱与 Agent 执行后续要求 Linux；数据库验收优先本地构建/本地 PG+Redis 复跑。R4 最新状态见上方里程碑表。

## 许可证与商业授权 ⚖️

本项目以 **[PolyForm Noncommercial License 1.0.0](LICENSE)** 发布 —— **源码公开,仅限非商业用途**(非 OSI 开源)。

> Required Notice: Copyright 2026 mycyg (https://github.com/mycyg/WorkHub)

- ✅ **允许**:个人学习、研究、实验、爱好项目,以及非营利 / 教育 / 公益 / 政府机构使用。
- ⛔ **禁止**:任何**商业化**或**真实企业生产场景**的使用。
- 📩 **商业 / 企业授权须经版权所有者书面许可。** 需要商用授权请通过 GitHub 联系 [@mycyg](https://github.com/mycyg)。
