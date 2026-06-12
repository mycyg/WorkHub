---
module: R5-sandbox-libraries-and-skills
layer: P-AI / packages-tools / 部署 / CI
status: completed
owner: workflow
date: 2026-06-12
depends_on:
  - r5-11-pilot-deploy-package-plan-2026-06-12.md
  - r5-10-pre-agent-capability-hardening-plan-2026-06-12.md
  - ../02-ai-engine/agent-loop-and-tools.md
  - ../06-roadmap/functional-requirements.md
---

# R5.11.1 沙箱能力库 + 预设技能 Plan

## 1. 背景

R5.11 竣工后确认：交付管线完整，但富格式交付物（docx/xlsx/pptx/统计图表）受限于沙箱"禁装包/禁网"——python 标准库写不出 Office 文件。约束在镜像内容，不在 agent 框架。同时，给了库不等于会用：LLM 凭记忆写库代码容易"胡乱调用"（API 幻觉、版本错位、中文字体缺失）。

两件事一刀做：**镜像预装白名单库** + **预设技能（SKILL.md 格式）锁定每类交付物的正确做法**。安全模型不变：沙箱仍禁网、命令白名单不扩（pip 不在白名单内，工人无法自行装包）。

## 2. 目标

### L1 镜像库预装（Dockerfile）

| 能力 | 库（pin 版本） |
|---|---|
| Word 文档 | python-docx |
| Excel 表格 | openpyxl |
| PPT 演示 | python-pptx |
| 统计图表 | matplotlib（+ `fonts-noto-cjk` 保中文标签） |
| 数据/数学统计 | pandas、numpy |

- Debian bookworm `pip install --break-system-packages`，版本 pin；
- 本机 dev 无这些库属正常——技能文档明确"完整库集合以 pilot 镜像为准"，工人遇 ImportError 按 blocker 上报而不是硬编。

### L2 预设技能系统（packages/tools）

- **格式**：`packages/tools/skills/<id>/SKILL.md`（开放的 Agent Skills 风格：frontmatter `name/description/when_to_use` + 正文为该交付物的库用法合同、代码模板、输出约定、自验步骤、常见坑）。
- **首发 7 个技能**：
  1. `docx-document` — Word（标题层级/段落/表格/页眉），python-docx 模板
  2. `xlsx-spreadsheet` — Excel（多 sheet/公式/列宽/数字格式），openpyxl 模板
  3. `pptx-deck` — PPT（版式选择/标题页/要点页/图片页），python-pptx 模板
  4. `stat-charts` — 统计图表（matplotlib 中文字体设置/折线/柱状/饼图/导出 PNG+源数据 CSV）
  5. `data-analysis` — pandas/numpy 分析（描述统计/分组聚合/相关性，产出 CSV+结论 md）
  6. `markdown-report` — 结构化文档报告约定（结论先行/数据引用/未尽事项）
  7. `code-script` — 代码脚本交付约定（入口注释/无网络假设/用 run_command 自验后交付）
- **运行时接入（防胡乱调用）**：
  - 新工具 `load_skill`（id → 返回 SKILL.md 全文；未知 id fail-closed 列出可用清单）；
  - 工人 system prompt 追加技能纪律："涉及下列交付物类型时，必须先 `load_skill` 对应技能再动手；库用法以技能为准，不得凭记忆臆写 API"+ 技能目录（id + 一句 when_to_use）；
  - 技能内容只进当次对话上下文，不改工具白名单、不动沙箱边界。

### L3 验证

- 单测：技能注册表完整性（7 个 id、frontmatter 合法）、`load_skill` 返回正文、未知 id fail-closed、目录注入 prompt；
- **CI `pilot-stack-smoke` 扩展**：容器内 `python3 -c "import pandas, numpy, matplotlib, docx, openpyxl, pptx"` + 实际生成一个 docx/xlsx/png 冒烟（证明库可用且字体在）；
- 全量回归（typecheck/test/lint/browser smoke/release gate）。

不做：pip 进命令白名单（禁装包不变）、联网类库（requests 等）、PDF 排版（reportlab 留待需求出现）、技能热加载/版本管理（v1 随仓库走）。

## 3. QA Gate

`pnpm --filter @workhub/tools test`、`pnpm --filter @workhub/api test`（prompt 注入断言）、CI `pilot-stack-smoke` 新增库冒烟段全绿、`pnpm typecheck`/`test`/release gate、`git diff --check`。

## 4. 竣工记录

状态：✅ completed（2026-06-12）

落地范围（L1–L3 全部完成）：

- **L1 镜像库**：Dockerfile 预装 `python-docx==1.1.2 / openpyxl==3.1.5 / python-pptx==1.0.2 / matplotlib==3.9.4 / pandas==2.2.3 / numpy==2.1.3` + `fonts-noto-cjk`；pip 不入命令白名单，能力面由镜像声明、工人不可扩。
- **L2 技能系统**：`packages/tools/skills/` 七个 SKILL.md（docx/xlsx/pptx/stat-charts/data-analysis/markdown-report/code-script），每个含验证过的代码模板、输出约定（如图表必配源数据 CSV、docx 配 md 镜像）、自验步骤与常见坑；`packages/tools/src/skills.ts` 提供注册表/`load_skill` 工具（未知 id fail-closed 列清单、id 正则防路径穿越）/`skillCatalogForPrompt()`；runner 默认工具集加入 `load_skill`，工人 system prompt 注入技能目录与硬纪律（先加载再动手、不得凭记忆臆写 API）。
- **L3 验证**：CI `pilot-stack-smoke` 新增库冒烟段——在部署容器内真实生成 docx（重开校验）、xlsx、中文标签柱状图 PNG（字节数校验）、pptx，并跑 pandas 分组聚合断言。

验收证据：

- CI run `27423950012`（commit `c6908d87`）七 job 全绿，库冒烟段通过——中文字体在容器内真实可渲染。
- 本机：`@workhub/tools` 7 测全过（注册表完整性/加载/fail-closed/防穿越）；typecheck、全包 test、`pnpm lint` 全链（cuu-r3 真实进程 smokes 已运行新 prompt 与工具注册）、release gate 全绿。
- DEPLOY.md 新增 §3.1 交付能力面说明。

### 4.1 R5.10-real 回灌修正（2026-06-13）

真 provider 首跑暴露两个工具调用契约问题：

- 工具注册表此前暴露给模型的 `input_schema` 只有 `{type:"object"}`，导致 DeepSeek 看不到 `write_file.path/content`、`read_file.path`、`load_skill.id` 等必填字段；现改为从 Zod schema 生成真实 JSON Schema，并新增回归门确认 `write_file` 的 required 字段会出现在 provider schema。
- DeepSeek 偶尔把 `load_skill` 参数写成 `{skill:"markdown-report"}`，或在只有一个 `inputs/` 文件时给 `read_file` 传自然语言 description；现 `load_skill.skill` 作为 `id` 的安全别名，`read_file` 仅在 `inputs/` 恰好一个文件时安全推断，否则继续 fail-closed 要求显式 path。

这些修正不扩大工具白名单、不允许路径逃逸、不允许依赖安装，只提升真模型遵循工具契约的成功率。

## 5. Handoff

技能与库已就绪，R5.10 真 key 验证的任务集可直接覆盖富格式（如"生成周度统计图表 PPT"），让评估报告反映真实业务交付面。后续技能扩展按 pilot 反馈增补（技能目录是开放 SKILL.md 格式，社区技能可直接放入）。下一刀回到 S1 主线：R5.12 权限矩阵审计。
