# R23 五路侦察报告（2026-09-05）

指挥家轮开局时对 origin/main + 2026-08-20 未提交修复批做的五路只读侦察，每条发现带 file:line 证据。
施工结论与状态见 `reports/审查台账-2026-08-19.md` 第十六、十七节。

| 文件 | 内容 | 侦察模型 |
|---|---|---|
| A-产品与集成度缺口.md | README 承诺 vs 可达路径、集成度、主动性链路、首日体验、产品空白（SA-01..SA-11） | fable |
| B-代码精简与去重.md | 死代码、web/桌面重复实现、超大文件拆分缝、loop/loop2 双轨、测试脆弱点、根目录资料目录 | opus |
| C-仓库卫生与清理清单.md | 86 个 git 工位与 154 条本地分支的并入判定、开放 PR 处置、stash、入库大文件、安全清理脚本草案 | sonnet |
| D-施工单核实与接线审计.md | F-01..F-10 逐项现状、零消费者端点、UI 动作与 Tauri 命令对账 | opus |
| E-依赖工具链与CI.md | pnpm outdated/audit、Rust 依赖、tsconfig、CI 结构、容器与部署、密钥扫描 | sonnet |

注意：C 报告里的清理脚本只含「已并入 main 且工作树干净」的工位，仍未执行，删除前请人工复核；
B 报告指出台账 WIRE-04 为误报（restore_pet_window_interaction 有 .ps1 调用方）。
