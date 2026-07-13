# R12 桌面工作台人工验收报告

- 测试日期：2026-07-13
- 时区：Asia/Singapore（UTC+8）
- 测试人：Codex（Computer Use + macOS 原生截屏/录屏）
- 结论：**不合格，打回修复**

判定依据：D、E 已失败，F 的玻璃组与窗口组也失败；即使不考虑 A/B/G 的账号阻塞，也不满足“ A–E 全过 + F 玻璃/窗口两组过”。

## 1. 七条主线结果总表

| 主线 | 结果 | 一句话结论 |
|---|---|---|
| A. 群聊闭环 | 阻塞 | 按任务书 `identify` 创建的阿曼/张三没有 `workspace_memberships`，均无法进入项目会话，双端 3 秒互见、输入态、断网恢复无法开测。 |
| B. 观察者行动卡 | 阻塞 | 真 LLM key 已有，但阿曼/张三双账号成员关系未建立，无法验证跨账号派活、按钮权限、撤销同步和 web 审批一致性。 |
| C. 协同会话 | 通过 | 按已知限制用 curl 预建会话；真实 LLM 流式回复、回复中第二条的温和提示、长文折叠、只观察拒绝提示均符合判据。 |
| D. 模式五档 | 失败 | chip 作用域正确且输入框数字不误切档，但点击/键盘均无法打开五档弹层，无法完成五档选择、警示色和断网回滚。 |
| E. 网盘与版本回滚 | 失败 | v1 上传和版本面板正常；同名 v2 上传被 API 以 409 拒绝，版本历史仍只有 v1，无法继续验证回滚生成 v3。 |
| F. 视觉/窗口/打扰 | 失败 | 圆角、最小化、关闭隐藏、重开保留状态通过；毛玻璃为均匀深色实底，标题栏拖动后窗口坐标不变。打扰矩阵因双账号阻塞未执行。 |
| G. 全托管自动合并 | 阻塞 | 张三不是 workspace 成员，无法按任务书把张三设为模式 5 并形成观察者派活对照组；本线本身不阻塞合格，但本次无有效结果。 |

## 2. 环境检查（任务书 §0）

| 检查项 | 结果 | 证据 |
|---|---|---|
| 真 `.app` | 通过 | 从开测时的 main 构建：`client-tauri/src-tauri/target/release/bundle/macos/WorkHub.app`。 |
| `.app` 构建 commit | 通过 | `5472b23c69c69a30e27566b501bf31fcc242ec05`（`main` / `origin/main`）。 |
| macOS | 通过 | macOS 26.5.1，Build 25F80。 |
| 双账号 | **失败/阻塞** | 阿曼、张三均成功建号且 `auth/me` 显示同一 workspace，但两人 `workspace_memberships` 行数为 0；阿曼访问项目会话返回 404。 |
| 真 LLM key | 通过 | API 进程 `LLM_API_KEY` 非空；`/api/me/ai-profile` 显示 DeepSeek configured，真实 `/turns` 请求成功并产生计费用量。 |
| API 日志 tee | 通过 | API stdout/stderr 已 tee 到 `/private/tmp/r12-api.log`，快照见附件 `api-r12-acceptance-20260713.log`。 |
| 原生截屏/录屏 | 通过 | F 线使用 `/usr/sbin/screencapture`，不是远程截图判断玻璃。 |

构建追踪备注：`.app` 在 10:35 的 `main@5472b23c` 上构建并完成本次测试。测试进行到 11:14 时，本工作树又产生了仅文档变更的 `2e4e23825ad30305a647e3c73c3415f286666852`（`docs(r13)`）；本报告不把后一个 commit 冒充为已测试构建。该 `.app` 能正常启动和执行验收，但 `codesign --verify --deep --strict` 报资源封印不一致；签名不在本任务书主线判据内，仅作为环境事实记录。

测试对象：

- 项目：`R12人工验收-20260713`
- project id：`cbd077ca-64b6-4048-bc30-03622a984465`
- main conversation id：`9d5ceb12-ed73-459b-8223-819f65c0fc9e`
- curl 预建 collab conversation id：`d419335b-6f74-4754-a168-578d68afbd1c`
- 指定账号：阿曼 `2d78577f-f8b3-4814-80b7-d46cb3c9b0f7`；张三 `d9405f90-da1d-4a3d-ad9d-9400d4c866c8`
- 可进入工作台的执行身份：WorkHub Desktop `92bf61b0-6179-47b1-b40b-1460e8e97899`

## 3. 失败与阻塞项

### ENV-01 / A-B-G：任务书指定双账号没有 workspace membership

复现步骤：

1. 用任务书 `demo-walkthrough.md` §0 的 curl A 分别 `identify` 阿曼和张三。
2. 分别调用 `/api/auth/me`；两端都返回 workspace `00000000-0000-4000-8000-000000000002`。
3. 用阿曼 cookie 调用 `/api/projects/bootstrap` 创建 `R12人工验收-20260713`。
4. 用同一阿曼 cookie 调用 `GET /api/projects/cbd077ca-64b6-4048-bc30-03622a984465/conversations`。
5. 查询 `workspace_memberships`，核对阿曼和张三的 active 成员行。

预期：阿曼、张三是同一 workspace 的有效成员；阿曼能拿到自动创建的 main conversation，双端可进入同一项目。

实际：两人均无 `workspace_memberships` 行；阿曼请求返回 `404 conversation_project_not_found`。已有成员 WorkHub Desktop 对同一项目请求为 200，证明项目和 main conversation 本身存在。工作台 UI 也只显示“1 位成员 + Cuu”。

- 失败发生时刻：2026-07-13 11:01（11:10 再次复现）
- 当时账号：阿曼、张三；机器：本机 macOS
- API request id：`0d53db0f-834e-4097-9127-d2207876bcb9`（阿曼，404）
- 截图：`evidence/A-01-double-account-membership-blocked-20260713-1134.png`
- 文本证据：`evidence/A-01-membership-check.txt`

影响：A、B、G 无法按任务书硬判据执行。没有直接插数据库或用别的昵称冒充张三。

### D-01：模式 chip 无法打开五档弹层

复现步骤：

1. 用 WorkHub Desktop 进入 curl 预建的 `R12验收协同会话`。
2. 确认主区没有模式 chip、协同会话有“我的模式：分级自动”。
3. 点击模式 chip；再分别尝试 Tab 聚焦后 Return、Space、Alt+Down，以及前台坐标点击。
4. 观察是否出现五档弹层，并检查 API 是否发出 profile PATCH。

预期：弹层打开并显示五档；第 5 档为警示色；弹层内 1–5 可切档。

实际：五档弹层始终不出现，API 没有模式 PATCH，profile 保持 `default_mode=3`。作为独立子项，输入框聚焦时输入 `12345` 没有误切档，这一点通过。

- 失败发生时刻：2026-07-13 11:24；11:40 在前台窗口再次复现
- 当时账号：WorkHub Desktop；机器：本机 macOS
- 截图：`evidence/D-01-mode-popover-no-response-20260713-1140.jpg`
- 文本证据：`evidence/D-01-mode-popover-check.txt`

后续为了完成 C 线“只观察拒绝”行为检查，使用 API PATCH 临时将模式设为 1；UI 随即显示“只观察”，发消息后提示“点输入框旁的「模式」切换后再试”。测试后已 PATCH 回 3。该 API 操作不用于宣称 D 通过。

### E-01：同名文件第二次上传返回 409，未生成 v2

复现步骤：

1. 在工作台网盘上传 `r12-version-test.txt` v1（67 B）。
2. 打开“版本”，确认版本历史只有 v1。
3. 修改同一本地文件内容为 v2（117 B），保持文件名不变。
4. 再次通过原生文件选择器上传同名文件。
5. 刷新网盘并调用 versions API。

预期：同名上传成功并新增 v2；后续可对 v1 执行“找回这个版本”，生成 v3 且历史不丢。

实际：桌面端发出两个同名上传 POST，API 均返回 409；列表仍显示 67 B，versions API 只有 v1，因此回滚链无法继续。

- 失败发生时刻：2026-07-13 11:30
- 当时账号：WorkHub Desktop；机器：本机 macOS
- API request id：`1daf2cee-3baf-411e-aeb1-6ab3665b8b6b`、`7adc5b4a-caa1-423c-9f16-5a42bef5f137`
- 截图：`evidence/E-01-same-name-upload-409-20260713-1131.jpg`
- 文本证据：`evidence/E-01-version-check.txt`

### F-01：工作台没有任务书要求的毛玻璃透景

复现步骤：

1. 使用本次 main 构建的真 `.app` 打开工作台。
2. 将工作台置于白色 Codex 窗口上方。
3. 用 macOS 原生 `screencapture` 截取工作台及周围背景。
4. 观察窗口内容区是否能看到背景模糊透出，以及四角是否有黑边残角。

预期：窗口能透出后方白色窗口/桌面轮廓的模糊感，不是纯深色实底；圆角无黑边残角。

实际：工作台为均匀深色实底，后方白色窗口完全不透出；四角圆角本身正常，无黑边残角。

- 失败发生时刻：2026-07-13 11:43
- 当时账号：WorkHub Desktop；机器：本机 macOS
- 原生截图：`evidence/F-09-native-glass-region-20260713-1143.png`
- 隔离窗口截图：`evidence/F-07-native-window-20260713-1133.png`

### F-02：拖标题栏不能移动工作台窗口

复现步骤：

1. 用 CoreGraphics 记录工作台初始 bounds：`X=512, Y=218, Width=1280, Height=800`。
2. 在标题栏做四次跨方向拖动，其中两次录屏留证。
3. 再次读取 CoreGraphics bounds。

预期：标题栏拖动后窗口位置随指针改变。

实际：四次拖动后 bounds 仍为 `X=512, Y=218, Width=1280, Height=800`，窗口未移动。

- 失败发生时刻：2026-07-13 11:37；11:46 录屏复现
- 当时账号：WorkHub Desktop；机器：本机 macOS
- 录屏：`evidence/F-02-titlebar-drag-20260713-1146.mov`
- 坐标证据：`evidence/F-02-window-bounds.txt`

同组已通过项：最小化正常；关闭按钮会隐藏而非退出；隐藏后通过 Spotlight“打开工作台”可再次唤起，协同会话、消息、网盘侧栏状态仍在。

## 4. C 线通过明细

1. 按已知限制用 curl 预建 collab 会话；未把“没有 UI 创建入口”报为 bug。
2. 11:22 发送消息后立即出现“Cuu 正在回复…”，真实 `/turns` 201，约 6.3 秒落定正式消息。
3. 长回复期间再发第二条，UI 显示“Cuu 正忙着上一轮，等它说完再试”；API `/turns` 返回预期 409，该条不自动重试。
4. 长回复超过阈值后显示“展开全文”。
5. 通过 API 将当前账号临时设为只观察后，UI 立即显示只观察提示；发送消息被拒并明确指向输入框旁的“模式”。
6. 本次回复未产生记忆引用，因此“记忆引用可展开”无可用样本，不单独判失败。

证据：`evidence/C-01-streaming-and-busy-prompt-20260713-1123.jpg`；API request id `e88d23e4-dc60-4b67-babf-39cf3dd43b84`（首个真实 turn 201）、`1b5de8e0-a108-40d1-9074-ff752e7cf56b`（忙碌 409）。

## 5. 未执行与免报边界

- A、B、G：因任务书指定双账号 membership 缺口阻塞，未用数据库直改或替代昵称绕过。
- F 打扰矩阵：需要有效双账号和跨项目派活事件，随 A/B 阻塞未执行；即使失败也只属于已知降级，不改变本次已不合格结论。
- 任务书 §2 的九条已知问题均未作为失败项上报。
- C 的 curl 预建会话是任务书明确的已知入口缺口，未当作 bug。

## 6. 附件

- `api-r12-acceptance-20260713.log`：API tee 日志快照
- `evidence/`：截图、录屏和精简文本证据
- `evidence/r12-version-test.txt`：最终 v2 本地测试夹具（服务端仍只有 v1）
