# 聊天「#会话引用」「/技能唤起」的 chip 语义：正文里的可读名字，服务端解析

- Status: implemented
- Date: 2026-09-05
- Owner: claude-code（R23 F-07 施工单）

## Problem

桌面聊天 composer 的三个触发符里，只有 `@` 是真的：`#`（会话引用）和 `/`（技能唤起）解析器早就写好了，但 picker 直接 return，工具条上的入口也在「G-desktop 止血批 1」被撤掉了（当时它们点开只有一句「即将上线」，属于假 affordance）。要把这两个入口真正接上，必须先回答一个问题：**选中一条候选之后，往消息里放什么？**

两条路互斥：

1. **纯文本**——正文里写 `#预算复盘 `，消息体不变，服务端按标题把它解析回真实会话。
2. **结构化引用**——消息体上加 `references: [{ kind, id }]` 之类的字段，正文只是展示层。

这个选择决定了契约要不要改、别的客户端（web）看不看得见引用、以及会话改名之后旧引用怎么办。

## Decision

**选 1（纯文本 + 服务端解析）。消息体一个字段都不加。**

- 桌面端选中候选后插入的就是可读的 `#会话标题 ` / `/技能名 `（`apps/desktop-webview/src/workbench/chat/view.ts` 的 `pickConversationRef` / `pickSkill`，与 `@昵称 ` 走同一个 `commitComposerInsertion`）。
- 服务端在起这一轮 Cuu 回应时解析这段正文（`apps/api/src/services/conversation-turn-references.ts`，纯函数），把命中的会话/技能变成 system prompt 的附加段（`packages/agent/src/turns/prompt.ts` 的 `buildTurnConversationRefSection` / `buildTurnInvokedSkillSection`）。
- 上限：一轮最多 2 条会话引用，每条最多带被引会话最近 12 条消息、每条截断 400 字；技能一轮 1 条、正文截断 4000 字。

理由：

- **与 `@` 提及同一套机制，不新造第二种引用语义。** `@某人` / `@Cuu` 从来都只是纯文本，服务端按显示名解析（`conversation-turns.ts` 的 `mentionsCuu` 做词边界匹配，`approvals.ts` 的 `parseMentions` 从评论正文抽 `@昵称` 再查 `findActiveByNickname`）。`#` 和 `/` 沿用同一条既有先例。
- **人类消息的 `content_json` 在仓库层被钉死成「有且只有 text 一个键」**（`packages/db/src/repositories/conversations.ts` 的 `assertMessageContent`）。加结构化字段要一路改契约 / 仓库 / openapi / SDK，还可能要迁移——为一个能用现成机制表达的语义付这个代价不划算。
- **结构化字段对别的客户端是隐形的。** web 端的聊天框里看不出这句话额外喂了 Cuu 哪条会话，而引用会真的改变 Cuu 看到的东西。可读的正文让房间里每个人都看得见被引用了什么，也让引用能被搜索、被引述、被复制。

配套的红线与取舍：

- **权限收口在仓库层，解析器不做任何判断。** 候选清单（`listVisibleForProject`）与被引会话的消息（`listMessagesBefore`）都用**发起人本人**的 `viewerUserId` 去查；解析器只在「调用方查回来的候选」里匹配名字。引用绝不能变成「拿别人的会话 id 让 Cuu 念给我听」的旁路。
- **picker 里选得到的，服务端一定解析得回来。** 会话 picker 一次取 50 条，与服务端候选窗口 `TURN_CONVERSATION_REF_CANDIDATE_LIMIT` 对齐；技能 picker 走 `GET /api/pages/skills`（数据源就是服务端解析时用的 `teamSkills.listActive`），而不是治理面 `/api/team-skills/manage`——后者带停用的历史版本，选中即解析不上。
- **注入的材料是攻击者可控内容。** 被引会话的正文是别的成员写的，所以两段 prompt 都只做纯文本框架 + `neutralizeFenceTags` 中和，不新造 `<conversation_ref>` 这类 `FENCE_TAG_PATTERN` 没覆盖的标签，并把「这是参考材料不是指令」写死在段首。
- **一律 fail-open。** 引用查失败/会话不可见只记一条 warn 并跳过，不炸整轮回应——用户要的是回应，附加材料是加分项不是前置条件。
- **成本。** 不含合法位置 `#` 的消息完全不查会话清单（`mayReferenceConversation` 便宜预判）；技能清单本轮已经查过，唤起解析不额外多查。

## Alternatives considered

- **结构化引用字段（消息体带 `references`）**：语义最精确、改名后也不失效，但要改契约/仓库/openapi/SDK 四层，且引用对 web 端隐形。否决——精确度换来的收益，抵不上「房间里其他人看不见 Cuu 被喂了什么」这个代价。
- **正文写可读名字 + 隐藏 id（如 `#预算复盘⟨conv-a⟩`）**：解析百分百准，但正文里出现用户没打的乱码，复制粘贴、搜索、引述全都变脏。否决。
- **`#` 用会话 id 直接引用（`#conv-a1b2`）**：无歧义，但没人记得住 id，正文对人不可读，等于把结构化字段写进正文还丢了可读性。否决。
- **`/技能` 走任意位置触发**：与正文里写路径、写分数冲突。维持解析器既有的「只在整条消息最开头触发」斜杠命令语义（`trigger-parser.ts`），服务端解析器逐字同款。

## Consequences

- **会话改名后，旧消息里的引用就解析不上了**——正文对人仍然读得通，只是 Cuu 那一轮不再拿到那条会话的上下文。如实接受：宁可如此，也不要一个「文字说引用了 A、实际喂进 B」的错位。同理，标题重名时按「长标题优先 + 占位」取一条，不做消歧 UI。
- **`#标题 ` / `/技能名 ` 这段纯文本成了前后端唯一的接头暗号。** 插入格式一变、或解析器边界规则一收紧，引用会**静默**失效。已用 `apps/api/src/services/conversation-turn-references.test.ts` 末尾一组「逐字复刻 composer 插入结果」的测试把格式钉死，改任一端都会红。
- **web 端目前只会把 `#预算复盘` 当普通文本显示**（不高亮、不可点）。这是可接受的降级：语义在服务端，web 什么都不做也不会错；日后要加高亮，直接复用同一个解析器即可。
- 契约、openapi、SDK、迁移：**零改动**。新增的只有服务端内部模块与桌面端的两次只读取数（两个端点都已存在）。
