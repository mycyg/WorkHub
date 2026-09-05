# 三件小活：r1-pg-smoke 复跑幂等 / 桌面死码清理 / 命令面板文案入词典

- Status: implemented
- Date: 2026-09-06
- Owner: claude（r26/z-small-fixes 工位，W-Z）

## Problem

三件互不相关的小活，合成一批施工。

**一、`qa:r1-pg-smoke` 在同一个库上复跑会假红。** CI 每次都是新容器，从没暴露过；本机反复跑
（这是常态——本仓多条 memory 都记过「r1-pg-smoke 本机复跑会撞」类的坑）就会踩。命令面板/桌面死码
两件事本身没有复跑问题，但第一件挖下去发现不是一个坑，是三个坑摞在一起，逐个撞上：

1. 并发探针 `r9-concurrency-probe` 用固定 `key` 做 L2 记忆的乐观 CAS 断言，种子步骤把 `valueMd`
   写死成「初始偏好。」——第二次跑时这一行已经被上一次跑的并发探针改成了「并发 A/B 版偏好」，
   种子 `mergeUpsert`（无 base）直接落进 conflict 分支，脚本判定「应为 upserted」就地假红。
2. 「主线工单」这条 outputs/ 交付物的路径写死成 `"outputs/result.md"`，而它挂在的项目是
   `defaultSeedFixture.projects` 那个固定 id 的种子项目（`ensureDefaultSeed` 幂等插入、跨进程
   持久存在）。第二次跑的全新工单第一次合并提案时，网盘里已经有上一次跑留下的同路径「正式版」，
   触发一次意料之外的「和正式版撞车」409（`ProposalServiceMergeConflictError`），脚本没有预期
   这个分支，直接抛出未捕获异常。
3. 「R2 原子预算」并发 deny 门把 `team/day` cap 压到「一个 run 的额度」来测「两个并发入队恰好一个
   赢」，收尾时用 `releaseExpired` 模拟胜者崩溃释放、让原来的败者重新入队——但这第二次入队造出的
   run 从此再没人释放它的预留，脚本结束时这份 `active` 预留原样留在真库里。第二次跑到这条门时，
   `team/day` 已用量被上一次跑遗留的这份预留顶满（cap 本来就只够一个 run），造成两个全新并发入队
   双双 402——不是「恰好一个赢」，是「一个都赢不了」。

**二、`desktop-cuu-runtime.ts` 里 `createDesktopCuuDemoScript` 是死码。** 文案审查已经标过：全仓
只有它自己的测试引用它，产线零调用方（Spotlight launcher 走的是真实推送流，不需要这个「录制
Gold Path 事件回放成 Tauri push-event/sse-status 序列」的演示脚本生成器）。

**三、`command-palette.ts` 里 96 条 `{ "zh-CN": …, en: … }` 内联文案违反「用户可见文案由 locale
独占」门禁（B5 R26 批已建的 `check-ui-i18n.ts`）。这 96 条里，36 条是 18 个命令的 label/hint
展示文案（必须搬），60 条是 `keywords` 搜索词数组里含汉字的中文搜索词（不是展示文案，F1 注释已
说明为什么保留原地——用户按旧叫法搜索也要搜得到）。

## Decision

**一、并发探针：种子步骤按 `mergeUpsert` 自己的返回状态分流，不强行要求 `upserted`。**
`conflict` 分支说明这一行已经真实存在（大概率是上次跑的遗留），不是异常；此时用一次**不参与
并发**的 `mergeUpsert(valueMd: 初始值, baseValueMd: 现存值)` 把它转回固定的「初始偏好。」——这一步
没有并发对手，CAS 必赢，得到一个确定、干净、且与两个候选值都不同的基点，再让下面的并发断言按
原样验证「同 base 并发写恰好一个赢家」。

这里有一个反直觉的坑，记录下来给后来者：**第一版修法**只是「把 conflict 报回来的现存值直接当
`baseValueMd` 喂给下面的并发对」，看起来同样「不放宽断言」，实测两次真跑就炸了——`["upserted",
"upserted"]`，双双成功、一个都没 conflict。根因是 `mergeUpsert` 有一条「新旧同值即放行、不比较
base」的快路径（`existing.valueMd === input.valueMd` 时直接走 CAS，不管 `baseValueMd`）：如果现存
值恰好等于本次两个候选值之一（比如上上次跑到 A 赢，这次的现存值就是「并发 A 版偏好」），候选 A
那一路会做一次「新值等于旧值」的空转更新——它真的 UPDATE 了一行（confidence/updatedAt 会变），但
没有把 `valueMd` 从现存值挪走；候选 B 那一路如果在它之后拿锁重新核对 `WHERE valueMd=现存值`，
仍然匹配（因为 A 那一路根本没把值改走），于是两路都能 upserted。这不是「丢更新」也不是「静默
双写」（A 的空转本来就没有内容变化，B 的迁移合法生效），但违反了这个探针本来要证明的前提——
两个候选必须都是「从同一个确实不同的基点出发的真实迁移」。**结论：凡是把「现存值」当 base 喂给
并发候选时，要么保证候选值集合与现存值互斥，要么（像这次一样）显式转回一个已知安全的基点，不能
假设「凡是并发用例就天然安全」。**

**二、把 outputs/ 交付物路径改成「模块级常量 + 每次进程启动一份随机后缀」。**
`smokeDeliverablePath = \`outputs/result-${randomUUID().slice(0, 8)}.md\``，跟种子用户
memory 记忆探针那条 `r9-concurrency-probe` 是同一个哲学的两种写法：探针那条是「固定 key，容忍
已存在」，这条是「路径本身就不固定，天然不会撞」。选路径随机化而不是「项目随机化」或「合并前
先删旧版本」，是因为这条测试的核心是「AgentRun 写文件→开提案→干净合并」这一条 HTTP 全链路，
换一个随机项目要么需要新增项目创建调用（扩大改动面），要么要绕开 session/intake 的默认项目
解析逻辑（这两者都不在本工位允许改动的文件范围内）；而"先删旧版本"违反了「不许放宽断言本身要
证明的东西」——删了历史就没法诚实证明「这就是一次干净的新增合并」。改路径只动本文件内的 4 处
引用（1 处 fake tool_use 输入、2 处直接 `writeFile`、1 处纯展示性的 `human_summary` 文本），
其余引用（`secondManifest`/`oneClickManifest` 的 `target_ref`）都是 `...firstChange.target_ref`
展开出来的，自动跟着第一条路径走，不用逐处改。

**三、「R2 原子预算」并发门收尾要释放它自己造的最后一个 run 的预留。**
`await loserQueue.abort(reReserve.run_id, { id: seedUser.id, isAdmin: true })`——跟脚本前面
B-R9.0-2 那段「断言后立即取消升级重试 run，释放它的 team/day 预算持有量」用的是同一个手法
（`queue.abort` 内部经 `reservationRepo.reconcile` 把持有量还回去）。这条门的注释本来就写了
「自包含：用自己的 work-item + 队列，结束后还原 team/day cap」——少的是「结束后也要释放自己
造出来的预留」这一步，只还原了 cap 数值，没还原预留状态。

**四、删桌面死码 `createDesktopCuuDemoScript` 时连它的私有辅助一起清。**
`selectDemoEvents`、`desktopShellPayloadFromWorkHubEvent`、`streamFromTopic` 三个私有函数、
本地类型别名 `type GoldPathEvent = GoldPathSurfaceVM["events"][number]`、以及因此不再被用到的
`GoldPathSurfaceVM` 类型导入，全仓 grep 确认零引用后一并删除——只删导出函数本身会把这些辅助
变成新的死码，不是清理，是搬家。

**五、命令面板文案搬词典用 `satisfies Record<CommandId, …>` 直接绑定既有的 `CommandId` 联合，
不新造一份平行的 key 类型。** 新建 `apps/desktop-webview/src/command-palette/locales.ts`
（文件与同名目录同级共存，文件系统层面无冲突），`zh`/`en` 两个对象都 `satisfies
Record<CommandId, { label: string; hint: string }>`——`CommandId` 是 `command-palette.ts`
里本来就存在、被 `spotlight/*` 多处引用的规范联合类型，不是重新派生一份「当前 18 个 key」的
影子类型：新增/删除一个命令但忘了同步词典，编译期直接过不去，不需要额外脚本盯注册表与词典
是否同步。调用点用 `...commandPaletteCopy(id)` 展开成 `{ label, hint }`，取代原来两行内联
字面量——写了一个脚本，把 18 个命令的新旧 `commandRegistry` 输出做了逐字段 JSON 深比较
（label/hint/keywords/icon/action 全部一致），确认渲染结果字节级未变，而不只是「测试还绿」这种
弱证据。

## Alternatives considered

**并发探针：让种子步骤在 conflict 时直接放行（不校验现存值，什么都不做）**：能让脚本跑起来，但
偷换了「起点必须确定」这个前提——如果现存值恰好等于某个候选值（如上面反直觉的坑所述），下面的
并发断言会静默失效而不报错，等于把断言的证明力阉割了。没选。

**budget 门：改用 `releaseExpired` 而不是 `queue.abort` 来释放 reReserve 的持有量**：
`releaseExpired` 在脚本这个位置调用会用「24 小时之后」这个远未来时间戳释放**所有**尚处于
active 状态的预留，不只是 `reReserve` 这一个——原作者自己在注释里承认这一点是「此刻只有胜者
一条 active 预留，远未来 now 只会释放它，不会误伤别的」这个前提下才敢用的窄口径工具。用它来
释放 `reReserve` 会把这个「只有一条」的前提又变造假，且 `queue.abort` 已经是脚本自己另一处
（B-R9.0-2）验证过的正确手法，选它更一致、更不容易带来新的隐藏耦合。

**桌面死码：只删导出函数，保留私有辅助「以防将来还用得上」**：三个私有函数已经全仓零引用，
留着才是真正的死码——「以防将来用得上」不是本仓的清理纪律（历史上多轮 review 的通病之一就是
「死码但没人敢删」），且它们的存在会让下一个读者误以为它们还在支撑某条真实链路。

**命令面板：用英文短语生成 camelCase key（照搬 codemod 的自动命名）**：这批是手工搬家不是跑
codemod，命令本身已经有一个清晰、稳定、不会拼错的 id（`CommandId` 联合的每个成员），直接拿来
当词典 key 比重新从英文文案生成一个不稳定的驼峰名更直接、可读性也更好。

## Consequences

- `qa:r1-pg-smoke` 现在可以在同一个库上任意次复跑：本机验证连跑 3 次（含一次干净库首跑）全部
  `exit 0`，随后 `qa:r1-pg-plugin-smoke` 复用同一个库同一份 env 再跑一次同样 `exit 0`，插件治理
  链没被前面三次改动波及。CI 每次新容器不受影响（本来就是「first pass on fresh DB」这条路径，
  三处修复都在这条路径上验证过原样通过）。
- `desktop-cuu-runtime.ts` 少了一个导出函数、三个私有函数、一个本地类型别名、一个类型导入；
  `desktop-cuu-runtime.test.ts` 少了它专属的一条测试与一个具名导入。全量测试从 1704 条降到
  1703 条（少的正是被删的那条），其余全绿。
- `command-palette.ts` 的 `ui-i18n-baseline.json` 存量从 96 条降到 60 条（label/hint 的 36 条
  已入词典；60 条 keywords 中文搜索词按设计原地保留，仍在基线里记账）；`desktop-cuu-runtime.ts`
  的存量从 7 条降到 6 条（删掉的 demo 脚本里唯一一句「连接不太稳，Cuu 正在重连。」不再出现）。
  全仓基线只有这两个文件的计数缩小，没有任何文件的计数变大——`check-ui-i18n.ts --write-baseline`
  重录前后逐文件比对过。
- 新增 `apps/desktop-webview/src/command-palette/locales.ts`：命令面板展示文案的单一来源，
  往后新增/修改任何命令的 label/hint 只改这一个文件；`keywords` 仍在 `command-palette.ts`
  原地维护（它是搜索词表，不是文案词典的管辖范围）。
