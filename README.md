# WorkHub

> **业务版 GitHub × AI-native 工作中台。AI 是默认劳动力,人是审批者与异常处理者。**

WorkHub 让团队里"绝大多数事"由 AI 默认完成,人只在 AI **做不好 / 做不了 / 不该做**时介入;无论 AI 还是人的改动,都经「提议 → 审批 → 合并」汇入单一可信源(main)。

- **AI 一人两顶帽子**:默认是产出交付物的「工人」;受阻(不合格 / 用户不满意 / 用户禁止)时化身「项目经理」组织人推进。
- **去 git 黑话的协作**:协作者各有"工作副本",AI 拟好改动 → 负责人确认 → 采纳;用户看不到 merge / 分支 / 冲突。
- **入口**:桌面宠物 + Web,Agent 几乎能操作所有功能,让小白也能顺畅使用。

## 现状:地基施工已开始 🚧

本仓库目前是 **产品规格文档树 + TS-first 地基脚手架**。规格已细化到屏级 / 接口级 / 功能级,实现代码会按 F01–F11 逐步加入。

- 📐 **规格树索引**:[`docs/workhub/`](docs/workhub/README.md) —— 32 篇(架构 / AI 引擎 / 协作 / 业务模块 / 客户端 / 路线图 / 成本治理)
- 📋 **PRD(总纲)**:[`docs/prd/2026-06-04-workhub-prd.md`](docs/prd/2026-06-04-workhub-prd.md)
- 💡 **缘起(头脑风暴)**:[`docs/brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md`](docs/brainstorms/2026-06-04-workhub-ai-native-platform-brainstorm.md)

**技术方向**:headless agent daemon + OpenAPI/SSE + PostgreSQL + Tauri 桌面端 / Web 瘦客户端(LAN-first,云就绪)。

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
- PostgreSQL/Redis 可用 `docker compose up -d postgres redis` 启动;Drizzle 迁移命令为 `pnpm db:generate`、`pnpm db:check`、`pnpm db:migrate`。
- 生产沙箱与 Agent 执行后续要求 Linux；Windows 当前用于开发、文档与地基验证。

## 许可证与商业授权 ⚖️

本项目以 **[PolyForm Noncommercial License 1.0.0](LICENSE)** 发布 —— **源码公开,仅限非商业用途**(非 OSI 开源)。

> Required Notice: Copyright 2026 mycyg (https://github.com/mycyg/WorkHub)

- ✅ **允许**:个人学习、研究、实验、爱好项目,以及非营利 / 教育 / 公益 / 政府机构使用。
- ⛔ **禁止**:任何**商业化**或**真实企业生产场景**的使用。
- 📩 **商业 / 企业授权须经版权所有者书面许可。** 需要商用授权请通过 GitHub 联系 [@mycyg](https://github.com/mycyg)。
