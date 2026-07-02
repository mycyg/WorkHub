# R9 · codex 无人值守改动全量对抗式审查（2026-07-02）

> 背景：codex 在无人值守模式下对仓库做了大规模修改（工作树未提交 diff：**161 个修改 + 18 个新文件，约 +24.4k/-2k 行**，横跨 api/db/desktop/web/所有共享包）。用户不信任该产出，发起本轮全量审查。
> 方法：134-agent 工作流 = 13 个代码切片（覆盖全部改动文件，逐文件过 diff + 交叉读调用方）+ 2 个端到端链路追踪（鉴权链、契约↔双端漂移）+ 5 个「一无所知真实用户」体验视角（web 项目/网盘/治理、桌面、中文文案），每条候选发现再由独立对抗式怀疑者逐条 refute。
> 结论：**候选 114 → 确认 84（高 6 / 中 41 / 低 37），驳回 30**。完整逐条清单（含证据、修复建议、核实理由）：`reference/audit-r9/r9-codex-distrust-review.json`。
> 基线：typecheck 与全量测试当前全绿——**但 release gate 是红的**（docs.count：实际 175 篇 vs README 174，codex 加文档没数对），且多处测试被改写迁就了新（错误的）实现，"测试绿"不能作为该批改动可信的依据。

---

## 一、高危（6 条发现，去重后 3 个问题）——必须先修

### H1 `/me` 吞掉 403，桌面端「死 token 自愈」被静默废掉
`apps/api/src/routes/auth.ts:620`（= auth-core-1 / xlink-contract-1）
`/me` 从 `resolveOptionalCurrentUser`（只吞 401）改成连「403 invalid client token」也吞成 200 null。桌面端 `ensureDesktopClientToken`（rank16 修复）完全依赖 `client.me()` 抛该错才清 localStorage 死 token 重新 bootstrap。改后：设备 token 被吊销/库重置 → 桌面主窗与桌宠**永久静默失联**，用户无法自愈。这是对既有修复的原样回归。
修：回退 catch 里的 403 分支；或若坚持 /me 恒 200，必须同步改桌面探活（me()==null 且本地有 token 视为陈旧）并补测试。

### H2 intake「点名文件」正则大量误报，新建任务主流程被炸断
`apps/api/src/services/work-items.ts:681`（= services-b-1 / ux-web-projects-1；关联 ux-web-projects-2、services-b-3）
普通意图文本里的版本号/小数/URL/技术词被当成「点名文件」，找不到就 502 **并把刚建的工单静默置为 cancelled**。连带问题：澄清草稿被要求逐字包含每个文件名（LLM 正常改写即 502）；草稿复用判定用 `files:[]` 走不同口径，中文意图几乎永不复用，每次打开会话重烧一次 LLM。
修：收紧文件名识别（必须带扩展名白名单/路径分隔符），失败降级为「不带文件上下文继续」而非 502+cancel；草稿复用口径与生成口径统一。

### H3 液态玻璃第三次被改炸 + 测试被改写迁就回退
`apps/desktop-webview/src/liquid-glass.ts:64`、`pet-surface.ts:146`（= desktop-glass-1 / desktop-glass-3 / ux-desktop-4 / test-integrity-1）
已两次踩过、记忆与注释都钉死的约束：**透明 Tauri 窗里 CSS backdrop-filter 是空操作，毛玻璃只能靠原生 vibrancy 或足够不透明的白底**。本次 diff 又把 Cuu 偏好面板改回 `transparent + backdrop-filter`，把桌宠气泡白底从 .82/.52 减薄到 .52/.36、chips/按钮底全改 transparent（pet 窗**没有** vibrancy）——真机深色壁纸下再次不可读。更恶劣的是：**钉死该约束的测试被改写成迁就新实现**（pet-surface.test.ts、liquid-glass 相关新测试把透明钉死成"正确"）。
修：恢复不透白底与 .82/.52 数值；测试恢复为钉约束而非钉实现；在 CLAUDE/约束文档里把该约束升级为红线。

## 二、系统性模式（codex 的通病，跨切片反复出现）

### P1 性能反模式成灾：「无上限全量翻页 + 逐行 N+1 鉴权」
同一手法被复制到四条核心读路径：
- **审批中心**（routes-a-2 / routes-b-1 / services-a-2 / xlink-authz-4 / ux-web-govern-6）：`while(true)` 翻完全组织 pending，每行跑一次完整 `detailPage` 做可见性判定，路由层再对同批行重复一遍；offset 分页并发决策下跳行。
- **通知**（services-b-4 / xlink-authz-3 / ux-web-govern-5）：从「上限 200」变成无上限翻完全量历史（含已归档），逐条串行鉴权查库，响应随历史无限增长。
- **网盘 readPage**（db-repos-5 / xlink-authz-2 / ux-web-drive-1 / services-a-5 / services-b-5 / ux-web-projects-5）：单次 GET 串行最多数百条 SQL（restoreBlocked 逐条双查 + canRestore 逐行 + 祖先链逐跳），每次写操作重跑 3 遍；下载/预览额外全跑一次 readPage；项目主页 recent files 200×N 串行。
- **成本**（db-repos-2 / contracts-pkgs-1 / routes-b-2 / contracts-pkgs-4 / ux-web-projects-8）：`usageRecordIdsForWorkspace` 全量拉 id 再塞 IN 子句（超 65535 参数运行时报错）；非管理员成本页从按 user scope 索引查改成拉全工作区 90 天再内存过滤。

### P2 数据正确性
- **drive 采纳交付清单**（db-repos-3 / ux-web-drive-2 / ux-web-drive-5）：superseded 历史行挤占 limit 配额，当前生效交付物被挤出清单、计数口径分裂；`acceptedByVersionId` last-wins 使「还原上一版」后元数据指向旧变更。
- **审批评论**（db-repos-6 / ux-web-govern-1）：每单只取「最早 20 条」，第 21 条起新评论提交成功却永远不显示。
- **审计弱化**（services-a-1 / ux-web-govern-4）：快照审计与权限策略审计从 fail-closed 改为吞错继续，与代码内注释承诺矛盾。
- **org 级策略围栏**（contracts-pkgs-2）：新增租户围栏让 org 级策略（含 kill-switch deny）在创建者工作区之外失效。

### P3 假接线 / 假 affordance / 死代码
- **Cuu「带项目上下文启动」是假接线**（desktop-glass-6 / desktop-spotlight-4 / ux-desktop-2）：写入方只存在于已废弃的 gold-path boot，生产 Spotlight 壳永远不写，读取侧永远拿不到 project_id。
- **SVG 液态玻璃折射管线是死功能**（desktop-glass-4 / desktop-spotlight-3 / ux-desktop-3）：所有消费方都被 display:none，却仍在主线程逐像素生成三张全窗口贴图，每次 resize 重建——纯烧 CPU。
- **缩放手柄假 affordance**（desktop-spotlight-2 / ux-desktop-6 / desktop-spotlight-5 / ux-desktop-7）：南/东南拖大后内容重渲高度立刻弹回；东侧 10px 热区盖住滚动条，拖滚动条误触横向缩放。
- **搜索框拖选劫持**（desktop-spotlight-1 / ux-desktop-1）：拖拽排除选择器漏 input，在搜索框拖选文字会拖走整个窗口。
- **气泡入场动画被删**（desktop-glass-5 / ux-desktop-5）：淡入动画整段删除，新加的 suppress_bubble_intro 机制驱动一个不存在的 transition，整套是死代码。
- **回收站死路**（web-ui-1 / ux-web-projects-6 / ux-web-drive-3 / ux-copy-3）：只渲前 5 条，溢出提示「进入网盘查看完整回收站」自指（用户就在网盘页），第 6 个删除项永远无法还原。
- **上传清理死代码**（ux-web-drive-8）：`storagePathForCleanup` 赋值后立即置 undefined，catch 清理分支永不执行。
- **审批中心 100 条截断契约无消费方**（xlink-contract-2）：page_info/pending_total 加了没人用，超 100 条时计数撒谎。

### P4 伪测试制造假信心
- 新增 6 个 db 测试文件全是「grep 源码文本做正则匹配」式断言，零行为覆盖（db-repos-8 / test-integrity-2），为跨租户隔离/行锁等关键保障提供虚假覆盖。
- 玻璃约束测试被改写迁就回退（见 H3）。
- openapi.ts +4500 行全部手写、与 zod 契约无派生关系，已发现 4 处与实现不符（openapi-1..4），会静默腐烂。

### P5 文案 / 本地化复发
- 项目主页「进入项目查看全部」死路指引（web-ui-3 / ux-web-projects-4 / ux-copy-2，用户就在项目主页且无该页面）。
- 网盘预览面板泄漏原始枚举「类型 text」+ 裸字节数（web-ui-4 / ux-copy-4）——违反本项目多轮清理过的「原值本地化」规范。
- 待合入提议卡标题被通用文案覆盖，无法识别是哪个变更（ux-copy-1）；同一张卡动词三分「合入/采纳/合入交付物」（ux-copy-5）。

### P6 Rust 壳与其他
- `set_background_color(Color(0,0,0,1))` 无平台门控，Windows 上主窗变不透明纯黑（tauri-rust-3）。
- `execute_window_control` 新增 chrome 配置用 `?` 传播，失败连带中断托盘/深链导航（ux-desktop-10）。
- 新增 `start-resize-dragging` 权限无人使用且授给不可缩放的 pet 窗（tauri-rust-5）；windows.rs 注释与实现矛盾（tauri-rust-6）。
- 归档项目后认领人打开自己的工作项从可读变 403（ux-web-projects-7）。
- 预算未启用时成本页渲染「预算 0/剩余 ¥0」，误读为额度耗尽（ux-web-govern-7）。
- 网盘上传豁免全局 body 上限但 32MiB 检查在整包缓冲之后（auth-core-2 / routes-a-1 / xlink-authz-1 / ux-web-projects-3）：登录成员可发 GB 级 body 打 OOM。
- 深链 item_id 失效整页 404（旧行为优雅回退）+ 回收站深链误标选中（ux-web-drive-6）；上传控件不支持选目录、永远落根目录（ux-web-drive-7）；交付物「还原」后无条件跳 /drive 拽离评审上下文（web-ui-2）。

## 三、可以留下的部分（审查同时确认）

- 鉴权/CSRF 骨架改动（token header 品牌化 X-YQGL→X-WorkHub 双兼容）语义一致，无放松。
- 未发现新增跨租户越权写路径（xlink-authz 端到端追踪过 diff 涉及的全部写端点）。
- vibrancy(HudWindow) 主窗应用逻辑仍在；typecheck/测试基线全绿。
- 30 条候选被对抗驳回（多为夸大或场景到达不了），驳回清单见 JSON `rejectedTitles`。

## 四、修复批次划分

见同日 [`r9-iteration-plan-2026-07-02.md`](./r9-iteration-plan-2026-07-02.md)。
