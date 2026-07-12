# R12 桌面工作台 · 图文验收演示线脚本

> 给真机验收用（照着走，人来截图出报告）。不是代码，纯操作清单。四条线对应
> `04-codex-execution-guide.md` §8.0 与 `02-construction-plan.md` 批 8 要求的「群聊闭环 / 单聊产出 /
> 派活跨人 / 版本回滚」。每步给：**在哪个界面点什么** → **预期看到什么** → **对应后端验证 curl**。
>
> 写这份脚本前逐条核实过当前分支（`r12/workbench-full` @ `8626328b` + 本批 beforeSeq/性能/空态改动）
> 实际接线到什么程度——**不是每一步都有桌面 UI 按钮可点**。没有按钮的步骤明确标注「当前无桌面 UI」，
> 直接给 curl，不假装点了什么（04 §4 铁律 3）。这份诚实清单本身就是批 8 的一个交付物。

---

## 0. 前置准备

1. 起 API：`pnpm --filter @workhub/api dev`（默认 `http://localhost:8787`，真库门需要本地 PG 容器，
   按仓库既有 `scripts/qa/` 下的 smoke 脚本起）。
2. 起桌面客户端：`client-tauri` 真机 `.app`（浏览器预览渲染不出 vibrancy，这条走既有约束——见
   `r8-desktop-native-verification-harness.md`），或用 `pnpm --filter @workhub/desktop-webview dev`
   起纯前端 dev server 看非 vibrancy 部分。
3. 准备 **两个真实用户**（demo 线 3「派活跨人」需要两个人）：分别用昵称登录/识别（下方 curl A）。
4. 一条线走完手动清理：本脚本不做自动回滚，PG 数据会真实留痕（这正是"版本化可回滚"要验证的东西）。

**curl A：登录/识别两个用户，各自拿一份 cookie jar**

```bash
# 用户甲"阿曼"
curl -sc /tmp/wh-demo-cookie-a.txt -X POST http://localhost:8787/api/auth/identify \
  -H 'Content-Type: application/json' -d '{"nickname":"阿曼"}' | jq .

# 用户乙"张三"
curl -sc /tmp/wh-demo-cookie-b.txt -X POST http://localhost:8787/api/auth/identify \
  -H 'Content-Type: application/json' -d '{"nickname":"张三"}' | jq .
```

每条 curl 之后带 `-b /tmp/wh-demo-cookie-a.txt`（或 `-b`）复用同一份 cookie。响应里的 `id` 就是该用户的
`user_id`，后面派活/@ 引用要用。

**curl B：建一个项目（用甲的 cookie）**

```bash
curl -sb /tmp/wh-demo-cookie-a.txt -c /tmp/wh-demo-cookie-a.txt \
  -X POST http://localhost:8787/api/projects/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"name":"R12验收演示项目"}' | jq .
# 记下响应里的 project.id → 记作 $PROJECT_ID
```

新建的项目会自动建一个 `kind:"main"` 会话——`GET /api/projects/$PROJECT_ID/conversations` 能拿到它的
`id`（记作 `$MAIN_CONV_ID`）。用户乙需要先被拉进这个项目的 workspace 才能看到它——如果甲乙不在同一
workspace，走既有的邀请流程（`POST /api/auth/invites`），这份脚本假设两人已经同 workspace。

```bash
curl -sb /tmp/wh-demo-cookie-a.txt "http://localhost:8787/api/projects/$PROJECT_ID/conversations" | jq .
```

---

## 1. 演示线 · 群聊闭环

场景：主区讨论 → 静默 60 秒 → 观察者拎出行动卡 → （无桌面 UI 的部分）派活/接单 → 行动卡线程留痕。

| # | 界面动作 | 预期看到 | 后端验证 curl |
|---|---|---|---|
| 1.1 | 桌面：Spotlight（全局唤起键）输入「打开工作台」→ 回车 | 工作台窗口打开，左栏出现「R12验收演示项目」 | — |
| 1.2 | 左栏点这个项目 → 中栏自动挂载主区群聊 | 空群聊显示 Cuu 开场白："欢迎来到「R12验收演示项目」……丢个文件或说句话" | `GET /api/conversations/$MAIN_CONV_ID/messages?afterSeq=0` → `messages:[]` |
| 1.3 | 中栏 composer 打字："这周先把选题报告第三节重写一下，@张三 你比较熟这块口径" → 回车发送 | 消息气泡立即乐观渲染，随后落库确认；`@张三` 高亮 | `GET .../messages?afterSeq=0` → `messages[0].content.text` 含这句话，`seq:1` |
| 1.4 | **等待 60 秒静默**（不要再发消息）——**当前无桌面 UI** 显示"观察者正在分析"，静默直接发生在后端 | 群聊里不会有任何"分析中"提示（00 §9："60s 分析出错→静默失败……绝不在群聊里刷报错"，正常分析同理不刷屏） | 60 秒后轮询 `GET .../messages?afterSeq=1`；出现一条 `kind:"action_card"` 的新消息即观察者已产卡 |
| 1.5 | 中栏滚动到这条新消息 | 渲染一张最小摘要卡："Cuu 从讨论里拎出 N 件事" + 条目标题列表 + 注记"完整的行动卡交互（撤销/指派）由后续批次接入这个窗口" | 同上 curl 的 `content.items[]`，每条含 `id/kind/title_md/confidence/status` |
| 1.6 | **当前无桌面 UI**：点条目、执行 execute 项、决策 decide 项——批 3/4 只建了后端，见本报告「范围外发现」 | — | `POST /api/action-card-items/{itemId}/decide` body `{"action":"claim"}`（cookie 用条目 assignee，即张三）；`POST /api/action-card-items/{itemId}/undo`（撤销，assignee 或管理员可发） |
| 1.7 | 撤销后回中栏看该消息 | **已知缺口（本批未修，见汇报「范围外发现」）**：读接口层面撤销状态已经落库（`action_card_items.status="undone"`），但 `renderActionCardSummaryHtml` 当前不读 `items[].status`，卡面不会显示"已撤销"划线——这是留给下一批的真缺口，不是本条脚本的期望 | `GET .../messages` 里对应 `action_card` 消息的 `content` 是创建时快照，不随后续 decide/undo 自动更新（服务端改用 SSE `conversation.action_card.updated` 通知"该刷新了"，客户端目前不订阅这条） |

---

## 2. 演示线 · 单聊产出

场景：和 Cuu 开一个协同会话（1:1），发一句话，Cuu 出一次真实 turn 回应。

**已知缺口（脚本设计前已核实）**：桌面 composer 的"发送"目前只调用
`POST /conversations/:id/messages`（把消息落库），**不会**自动调用 `POST /conversations/:id/turns`
去真正唤起 Cuu——批 2 的既有注记就写了"本批不接 LLM——@Cuu 不会真的回应"，之后的批次也没有任何
desktop-webview 文件调用 `/turns`（本报告写作时逐文件核实过，零命中）。所以这条演示线的"Cuu 真的回一句"
只能靠 curl 触发，UI 端看到的是触发后落库的那条 Cuu 消息，不是"打字问它它就答"的完整体验。

| # | 界面动作 | 预期看到 | 后端验证 curl |
|---|---|---|---|
| 2.1 | **当前无桌面 UI**：开一个协同会话（1:1 with Cuu）目前只能建"人类协作会话"（`kind:"collab"`, 参与者是人），批 4 计划的"和 Cuu 单聊"UI 未在本分支发现独立入口——用 API 直接建一个只有甲一个人的 collab 会话代替 | — | `POST /api/projects/$PROJECT_ID/conversations` body `{"kind":"collab","title":"和Cuu对一下第三节","visibility":"private","participant_user_ids":[]}` → 记 `$COLLAB_CONV_ID` |
| 2.2 | 中栏（若前端已能挂载该会话——目前 rail.ts 只把「主区」叶子做成可点按钮，collab 会话列表本身走批 6 之后的路由，未在左栏出现导航入口）：手动改深链或用同一个 `mountChatView` 组件验证——**已知缺口**，本批未修 | 消息流为空 + composer 可用 | — |
| 2.3 | 用 curl 直接发一条用户消息 | — | `curl -sb .../cookie-a.txt -X POST .../conversations/$COLLAB_CONV_ID/messages -d '{"kind":"text","content":{"text":"帮我看看第三节的数据口径要不要统一"}}'` → 记响应 `id` 为 `$USER_MSG_ID` |
| 2.4 | 用 curl 触发一次真实 Cuu turn（需要真 LLM key，见「没做/存疑」） | — | `curl -sb .../cookie-a.txt -X POST .../conversations/$COLLAB_CONV_ID/turns -d "{\"user_message_id\":\"$USER_MSG_ID\"}"` → 响应 `data.message` 是 Cuu 的回应文本 |
| 2.5 | 桌面：若已挂载该会话视图，刷新/滚动 | Cuu 的回应作为一条新消息出现，头像是猫图标 | `GET .../messages?afterSeq=1` 应包含 `sender_type:"cuu"` 的新行 |
| 2.6 | 长回应折叠验证（本批新增）：让 Cuu 的回应超过 800 字，或手动发一条超长文本消息 | 消息气泡只显示前 400 字 + 底部渐隐 + "展开全文"按钮；点击后展开全文 + "收起"按钮 | 无需 curl，纯前端渲染验证（`renderMessageHtml` 的折叠逻辑，见 `chat/render.test.ts`） |

---

## 3. 演示线 · 派活跨人

场景：甲在群聊里的话被观察者拎成行动卡，execute 项派给乙；乙的视角上应该能"看到活来了"。

**已知缺口**：批 5 只做了军团面板的**服务端读侧**（`packages/db/src/repositories/conversation-runs.ts`
的三个只读聚合方法），没有对应的桌面 UI 面板——右栏情境面板目前渲染的是一段占位文案（
`shell.ts` 的 side-panel 占位，写着"接在批 5"，但批 5 实际只交付了数据层）。这条线在桌面上能看到的
只有两种情况：`dispatch_policy="ask"` 时的 Cuu 气泡通知（有真实 UI），或者什么都看不到（
`dispatch_policy="auto"` 时后端完全静默派发，desktop-cuu-runtime.ts 里确认无通知）。

| # | 界面动作 | 预期看到 | 后端验证 curl |
|---|---|---|---|
| 3.1 | 用乙的账号，桌面设置页（`/settings` 或 spotlight「设置」）把「接单策略」改成"先问我"（`dispatch_policy="ask"`） | 设置保存成功提示 | `curl -sb .../cookie-b.txt http://localhost:8787/api/me/ai-profile` 确认 `dispatch_policy:"ask"` |
| 3.2 | 甲：中栏群聊发一条会被观察者判定成 execute 且 assignee 大概率是乙的消息，如"这块麻烦张三来处理一下，帮忙重写一下摘要" | 消息正常发出 | — |
| 3.3 | 等 60 秒静默 → 观察者产卡 | 中栏出现 action_card 消息（同演示线 1 的 1.5） | `GET .../messages` 里新 action_card 消息 `content.items[]` 含 `kind:"execute"` 的一项 |
| 3.4 | 乙：**若工作台窗口不在前台**，桌宠气泡（pet-surface）应弹出通知 | 气泡文案类似"有个活想派给你"，带"去工作台看看"按钮，点击深链定位回这条会话 | 观察 `conversation.action_card.updated` SSE 事件（`GET /api/push/stream/conversation/:id` 或 `/me`）里 `data.items[]` |
| 3.5 | 乙：点桌宠气泡的"去工作台看看" | 工作台窗口打开/前台化，定位到这条会话 | — |
| 3.6 | 乙：**当前无桌面 UI**——接单/查看被指派的具体细节 | — | `POST /api/action-card-items/{itemId}/decide` body `{"action":"claim"}`（cookie 用乙） |
| 3.7 | 甲：中栏应该看到"阿墨已开工"之类的系统事件（03 文档 §1 的用户旅程描述） | **已知缺口**：本分支未找到观察者/接单后自动回贴系统事件到群聊线程的实现（`conversation-observer.ts` 只发 SSE，不追加 `system_event` 消息）——03 文档的旅程描述目前只是设计意图，未完全落地 | — |
| 3.8 | 军团总览验证（无 UI，直接 curl） | — | `curl -sb .../cookie-b.txt http://localhost:8787/api/me/army` 应该能看到这条 run；`GET /api/conversations/$MAIN_CONV_ID/army` 同理 |

---

## 4. 演示线 · 版本回滚

场景：网盘一个文件传两版，回滚到旧版本——这条是四条里**桌面 UI 最完整**的一条（批 6 交付）。

| # | 界面动作 | 预期看到 | 后端验证 curl |
|---|---|---|---|
| 4.1 | 工作台左栏（或 Spotlight）切到「网盘」标签 | 空态："这里还没有文件"（`drive/render.ts` 的 `wh-wb-drive-empty`） | `curl -sb ... "http://localhost:8787/api/pages/drive?projectId=$PROJECT_ID"` → `items:[]` |
| 4.2 | 拖一个文件到网盘区域，或点上传按钮选文件（如 `report-v1.docx`） | 文件出现在列表里，一条初始版本 | `GET /api/drive/projects/$PROJECT_ID/items/{itemId}/versions` → 一条版本记录 |
| 4.3 | 再上传一份**同名/同目标**文件的新内容（如改过的 `report-v1.docx`），或走合并产生新版本的路径 | 文件行更新，版本数变化 | 同上 curl → 两条版本记录，`current` 指向最新 |
| 4.4 | 点文件行的「版本」按钮（`data-wb-drive-open-versions`） | 右栏弹出版本历史列表，每条版本带时间戳 + 「找回之前的版本」按钮（`data-wb-drive-restore-version`，注意文案是"找回之前的版本"不是"revert"——04 §4 铁律 12 去黑话要求） | — |
| 4.5 | 点旧版本那条的「找回之前的版本」 | 按钮进入 busy 态（disabled + 忙碌样式），成功后版本列表刷新，**新增一条**版本（回滚是追加新版本，不抹历史——03 §2F） | `POST /api/drive/projects/$PROJECT_ID/items/{itemId}/versions/{versionId}/restore` → 201/200，响应里的新版本 `id` ≠ 触发前的 `current_version_id` |
| 4.6 | 再次打开版本历史 | 能看到完整版本链：v1 → v2 → 回滚产生的 v3（内容同 v1，但作为一条新记录留痕） | `GET .../versions` → 3 条记录 |
| 4.7 | 中栏群聊（若该网盘操作有系统事件卡设计） | **待确认**：批 6 报告提到"合并后自动归档+系统事件卡"，真机验收时核对群聊里是否真的出现这条系统事件消息 | `GET $MAIN_CONV_ID/messages` 里找 `kind:"system_event"` 且内容提到该文件名的消息 |

---

## 5. 本批（批 8）新增能力的针对性验证

不算在四条演示线里，但既然是本批的直接交付物，真机验收顺手过一遍：

| # | 验证点 | 操作 | 预期 |
|---|---|---|---|
| 5.1 | beforeSeq 反向翻页 | 一个会话攒 350+ 条消息（脚本/循环发送），中栏滚动到顶 | 触发"加载更早"（先本地展开 DOM 窗口，展开完再真的发 `beforeSeq` 请求），滚动位置不跳动（锚定在原来看的那条消息） | `GET .../messages?beforeSeq=<seq>&limit=100` 返回更早一页，`next_before_seq` 递减 |
| 5.2 | 首屏改为拉最新页 | 刷新/重挂载一个有很长历史的会话 | 立刻看到最新消息（不再从头正向拉全量），加载动画时间明显短于批 2 的旧实现 | `GET .../messages?beforeSeq=9007199254740991&limit=100` 一次拿到最新一页 |
| 5.3 | 消息列表窗口化 | 同 5.1 的长会话，只滚动不点"展开" | DOM 里同时存在的消息气泡数不超过 300（浏览器 devtools 数 `.wh-wb-chat-msg` 节点数） | — |
| 5.4 | 长文本折叠 | 发一条 900 字的消息 | 只显示前 400 字 + "展开全文"，点击后展开 + "收起" | — |
| 5.5 | 无权限深链空态 | 用乙的账号，深链到一个甲私有、乙不在其中的 collab 会话 id | 中栏显示"你不在这个项目里"，无死重试按钮 | `GET .../messages`（乙的 cookie）→ 404 `conversation_not_found` |

---

## 附：本脚本诚实边界

写这份脚本时逐项核实过桌面前端接线现状（不是从 02/03 文档直接照抄理想流程）。凡标"当前无桌面 UI"/
"已知缺口"的步骤，都是本次核实中发现的、超出批 8 范围围栏（`apps/desktop-webview/src/workbench/chat/**`
以外）的真实差距，已经在 `reports/batch-8-hardening.md` 的「范围外发现」一节同步列出，供后续批次或
人工裁决要不要补。这些缺口**不是本批引入的**，只是首次被系统性地核实并写下来。
