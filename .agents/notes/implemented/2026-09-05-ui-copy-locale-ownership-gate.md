# 用户可见文案由 locale 独占：AST 门禁 + 棘轮基线 + 机械搬家

- Status: implemented
- Date: 2026-09-05
- Owner: claude（r26/u-ui-i18n-gate 工位，B5）

## Problem

两个互相咬合的洞。

**洞一：文案没有单一来源。** 渲染代码里到处是 `zh ? "中文" : "English"`。立项时按
`locale === "zh-CN" ?` 这一种写法数出「261 处」，但真实写法是先 `const zh = input.locale === "zh-CN"`
再 `zh ? … : …`，还有 `zh: boolean` 参数一路往下传。用「含汉字的字符串字面量出现在非词典文件里」
这条判据实测，**产品代码里是 5732 处、252 个文件**——比立项估计大 20 倍。词典系统本身早就建好了
（5 个模块 2136 行），问题从来不是没有词典，是没有东西拦着人不用它。

**洞二：禁词门只扫 5 个文件。** `check-copy-terms.ts` 手写了 5 个词典文件路径，它自己在注释里
承认是「最低限度防线」。那 5732 处文案、以及整个桌面端，全在门禁覆盖之外——所以「去黑话/不用
AI 味套话」这条纪律实际上只对不到 4% 的文案生效。

两个洞是同一个洞：**扫描范围和文案实际位置不重合**。文案全进词典，第二个洞自动补上。

## Decision

**判据换成「含汉字的字面量住在非词典文件里」，不是上游那套文案属性识别。**
形状借 deepseek-harness 的 `scripts/verify-client-ui-i18n.ts`（MIT）：TypeScript 编译器 API 遍历 +
「只有 locale 文件可以拥有译文」的允许列表 + `MINIMUM_SOURCES` 下限防扫描器自身失效。但上游靠
JSX 文本、14 个文案属性、后缀正则来猜「这个字符串是不是文案」——我们没有 JSX，而中文字面量本身
就是一个**又简单又准**的信号：不需要猜，看见汉字就是文案。走 AST 而不是正则，注释里的中文、
正则字面量里的字符类、行尾中文注释全都天然不算。

**允许拥有中文的文件名固定四种**：`i18n*.ts` / `locale*.ts`（含 `locales.ts`）/ `locales/` 目录下 /
`*-copy.ts`。最后一条是承认既有先例（`connection-banner-copy.ts`、`ai-provider-banner-copy.ts`），
不另起炉灶。

**上棘轮基线，不搞「先全量豁免、以后再说」。** `ui-i18n-baseline.json` 按「文件 + 归一化片段 → 次数」
记，**不按行号**——重排代码、加注释、改缩进都不会假红，而搬走一条就会提示「基线条目已消失，请删除」。
新增一处即 exit 1。归一化会剥控制字符：TypeScript 给模板字面量的 `.text` 带内部标记字符，留在基线
里会变成既不可读也不可手改的键。

**真不是界面文案的中文串走行内 `ui-i18n-allow`**，与既有的 `term-allow` 同一套约定。模型提示词、
写给日志的中文属于这一类——把它们逼进 locale 词典是错的，它们不是给人看的。

**两个门共用一份文件发现逻辑。** 禁词门的扫描目标改成 `copyTermScanTargets()` = 全部词典文件 +
基线里仍含文案的文件，从 5 个扩到 258 个。共用而不是复制第二份清单，是因为这两个门的失配正是
洞二的成因——它们必须永远看同一批文件。禁词门判据也一并从「整行含中文」升级成 AST 字面量。

**禁词门扩覆盖暴露的 25 处存量同样进棘轮，而不是就地改文案。** 改一个词就改了用户看到的字，要连
测试与 golden 一起动，那是产品决策不是搬家；而在 `packages/agent` 的提示词上撒 `term-allow` 又是
在撒谎（那些确实命中了禁词，只是不归这个门管）。诚实的做法是记账：存量 25 条列在
`copy-terms-baseline.json` 里等人拍板，新增一条都过不去。**这比现状严格**——现状是那 25 条根本不在
扫描范围内。

**pre-commit 只扫暂存文件。** 禁词门扩到 258 个文件后全量要 5.45 秒，locale 独占门全量 587 个文件要
3 秒以上，都进不了 commit 时预算。两个门都补了 `--files`（路径谓词代替全量 glob），lefthook 传
`{staged_files}`，实测整条 pre-commit 链 3-5 秒。全量由 `pnpm lint` 与 CI 兜底。

**搬家用 codemod 而不是手改，词典按目录一份。** 一次性脚本（不进仓库）作用域感知地解析
`const zh = X === "zh-CN"` 与 `zh: boolean` 参数，把 `zh ? "中文" : "English"` 整体替换成
`模块T(locale, "key")`，键名由英文那一侧生成（camelCase、同 pair 复用同键）。19 份新词典按目录落，
形状照 dsh：**中文对象是 key 集事实源**，英文对象 `satisfies Record<keyof typeof zh, string>`——
少一个键或多一个键都编译不过，不需要额外脚本盯对称性。

**词典函数第一参数收 `WorkHubLocale | boolean`。** 这一层的渲染函数历史上有 239 处以 `zh: boolean`
传语言。把签名一起改成 `locale` 会牵动调用方，是另一件事；混进「文案搬家」这一批会让「渲染出来的
文案一个字都没变」这个判断失去可验证性。

## Alternatives considered

**只扫 `locale === "zh-CN" ? … : …` 这一种写法**（立项时的隐含假设）：会漏掉 95% 的文案，
而且给人留了「换个写法就绕过门禁」的口子。

**把新文案继续堆进 `packages/ui/src/gold-path/i18n.ts`**（已 652 行）：立项时就否掉了，理由成立——
一个包的所有文案挤一个文件，改任何一处都在同一份 diff 上打架。改成按目录一份 `locales.ts`。

**扫描范围只圈 UI 包（web/desktop/ui/cuu），放过 `apps/api` 与 `packages/agent`**：能少 2000 条
基线、少给别的工位添麻烦。没选，两个理由：`apps/api` 的 `pages/` 是真的在给用户渲页面，划线划在
包边界上会漏；而提示词那类真不该管的，`ui-i18n-allow` 一行就能豁免，比在扫描范围上开洞更精确、
也留得下理由。

**给禁词门的 25 处存量逐条加 `term-allow`**：最省事，但那是把「这是欠账」记成「这是豁免」。
基线能列出来、能被清点、清一条删一条；`term-allow` 撒出去就再也没人去数了。

**codemod 顺手把 `zh: boolean` 签名改成 `locale: WorkHubLocale`**：更干净，但那次改动会同时动
签名和调用方，出问题时无法区分「搬家搬错了」还是「签名改错了」。留给后来者，见下。

**不写基线、把 5732 处一次搬完**：搬得动的只有「三元」这一种形状（约 2000 处），剩下的是双语记录、
元组对照表、带插值的模板三元、无条件中文串——每一种都需要判断，不是机械替换。硬搬会把判断题
做成填空题。

## Consequences

- **门禁在，欠账在账上。** 全仓 5732 → 3648 处（-36%），桌面端 2086 → 662（-68%），
  `route-components.ts` 892 → 526。剩下的 3648 条在 `ui-i18n-baseline.json` 里，新增一处即 CI 红。
- **禁词门覆盖从 5 个文件到 258 个**，存量 25 条记在 `copy-terms-baseline.json`。这 25 条要不要改词
  是产品决策，需要拍板——改词会动测试与 golden。
- **立项时说的「53 个 key 不对称」不成立。** 逐文件核过：`packages/ui/src/i18n.ts` 235/235 对称，
  `gold-path/i18n.ts`、`cuu/src/i18n.ts` 都是 `as const satisfies Record<WorkHubLocale, Record<Key, string>>`，
  `apps/api/src/pages/i18n.ts` 是 `Record<WorkHubLocale, Record<PageCopyKey, string>>` 类型标注——
  四份都已经是编译期强制对称。那个 376 vs 338 的 grep 差值来自 `command-palette.ts` 的
  `{ "zh-CN": …, en: … }` 记录式写法（38 处，只是键名写成 `en` 不是 `"en-US"`，并不缺英文），
  以及散在各处的 `locale === "zh-CN"` 比较。**没有缺失的翻译要补。**
- **合并进 `r25/integration-4` 时要重录一次基线。** 本工位基线是 af8b59d8；集成分支此后又前进了
  20 个 commit，其中 `packages/agent/src/loop/doom-loop-reminder.ts`（12）、
  `packages/tools/src/seatbelt.ts`（9）、`apps/api/src/workers/agent-run-prompt.ts`（1）共 22 处中文
  会被门禁判为新增——那三处都不是界面文案（提醒话术 / 沙箱错误 / 提示词），合并后 `--write-baseline`
  重录一次，或逐行加 `ui-i18n-allow`。禁词门那边不受影响（已核）。
  `.github/workflows/verify.yml` 与 `package.json` 两处会有加行冲突，都是并列插入，取两边即可。
- **`scripts/` 现在有了测试与类型检查的落脚点**：`scripts/tsconfig.json` + `pnpm test:scripts`，
  在 verify.yml 的 workspace job 里单跑一步（`pnpm test` 的 `-r` 递归覆盖不到 scripts/）。
  目前只覆盖文案门这三个文件——`scripts/dev/desktop-version-files.ts` 有 5 处存量严格模式报错，
  清掉之后可以把 `files` 换成 `"include": ["dev/**/*.ts"]`。

### 后来者怎么继续搬

`tsx scripts/dev/check-ui-i18n.ts --report` 出按文件排序的清单。剩余 3648 条按形状分（本工位范围内
1871 条的普查结果，`apps/api`/`packages/agent` 另计）：

| 形状 | 条数 | 怎么搬 |
| --- | --- | --- |
| 对象属性值（非 zh/en 键） | 867 | 逐处判断：多数是无条件中文串，要先决定英文说什么 |
| 数组元素（搜索关键词等） | 345 | `command-palette.ts` 的 `keywords` 是大头，搬走要连搜索匹配一起想 |
| 带插值的模板三元 | 264 | 需要**参数化词条**（`(n) => \`共 ${n} 条\``），词典形状要扩 |
| 双语记录 `{ zh, en }` / `["中","En"]` | 208 | 整表搬进 `locales.ts` 拆成 zh/en 两张，见 `spotlight/labels.ts` 这次的做法 |
| 三元但认不出 locale | 116 | 条件不是 `zh` 也不是 `X === "zh-CN"`，逐处看 |

搬完一批：跑该包的测试与 `pnpm -r typecheck`（**渲染文案一个字都不能改**，红了就是搬错了，
不许改测试迁就），然后 `tsx scripts/dev/check-ui-i18n.ts --write-baseline` 重录基线，
禁词门若报「基线条目已消失/新增」同样用 `--write-baseline` 重录（前提是文案本身没动）。

顺带值得做的两件事：把 239 处 `zh: boolean` 签名改成 `locale: WorkHubLocale`，改完就能把各
`locales.ts` 里那个 `WorkHubLocale | boolean` 过渡口子收掉；以及把 `packages/ui/src/gold-path/i18n.ts`
的 652 行按主题拆进 `locales.ts` 家族。
