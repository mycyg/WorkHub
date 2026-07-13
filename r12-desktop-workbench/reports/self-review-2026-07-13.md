# R12 合并后自审（集成者亲自复核,非委托）

日期: 2026-07-13 · 基线: main @ 34c27119（PR #6 合并提交,CI 8/8 绿）
方式: 对高风险路径逐一读码复核——SSE 客户端、turns 超时/并发、观察者水位线、自动合并竞态、
行动卡按钮接线、深链暂存、模式弹层键盘、文案/黑话/emoji/监听器泄漏全扫。

## 结论

核心链路的工程质量过关:没有发现新的 P0。一条交互劫持当场修掉,两条健壮性项立案进 backlog,
一条此前审查的已知 P1 复核确认仍未修(如实留档)。

## 逐项判定

### 当场修掉
1. **模式弹层数字键劫持编辑区**(chat/view.ts handleDocumentModeKeydown):弹层开着时焦点若回到
   输入框,打 "1"-"5" 会被 preventDefault 并切档。已加可编辑区守卫(TEXTAREA/INPUT/contentEditable
   直接放行,Escape 不受限)。桌面 652 测试维持全绿。

### 立案 backlog(P2 健壮性)
2. **SSE 客户端无心跳看门狗**(chat/stream.ts):服务端有 heartbeat 帧但客户端不校验到帧间隔,
   TCP 半开时 reader.read() 可能长时间挂起而 UI 显示"已连接"。建议:онReconnected 体系上加
   "N 秒无任何帧即主动断开重连"的看门狗。
3. **观察者先派发后建卡推水位**(workers/conversation-observer.ts):execute/decide 派发在
   createOrAppendCard(含水位推进)之前;若建卡一步失败,下个 tick 会重分析同批消息、重复建工单。
   per-item try/catch 已把窗口缩到"建卡写库失败"这一种,概率很低但存在。建议:条目 id 由
   (conversationId, analyzedToSeq, ordinal) 确定性派生,靠唯一约束天然幂等。

### 复核确认仍未修(维持已知遗留)
4. **Cuu 回复中发第二条消息被晾住**(功能审查 P1-11):canSend 仍不看 turnActive,第二条消息的
   turn 请求 409 busy 后只有一句灰字、无重试/排队。属第二波。

### 复核通过(点名确认没问题)
- stream.ts 重连语义:干净断流也重连、attempt 成功归零、缺口用本地最高 seq 主动拉齐,dispose 配平。
- turns 超时:60s abort→统一 500 不落半截消息,timer/并发闸都在 finally 清理,空回复有守卫。
- 4b 自动合并:review→merge 失败开放降级人审;系统播报在结果确定之后(opened/auto_merged 不撒谎);
  与人审的竞态被提议状态机兜底。
- 深链暂存:15s TTL+消费即删+隐私模式降级,陈旧 stash 不会在无关的重新打开里误触发。
- 行动卡按钮:真 <button>(键盘可达),权限拿不准(管理员旁路)宁可不摆,409 已处理触发定向对账重取。
- 细节纪律:工作台源码 emoji 零命中;用户面 zh 文案 git 黑话零命中;doc 级监听器 add/remove 配平;
  escalation 回流幂等(transitionItemStatus null=已被处理,不报错)。

## 与既有 backlog 的关系

本次自审不重复功能审查(functional-review-2026-07-13.md)已立案的第二波项:设置面补齐(桌面 AI
分区+web 自救)、军团三区 UI(端点现成)、全托管透明度(reviewer_kind)、观察者工单来历标注、
网盘两端对称、dispatch_ask 深链到卡(需通知契约加 conversation_id)、托盘工作台入口、
键盘导航补丁(@ picker/模式弹层 tabindex)、labor-split 设计-实现缺口裁决。
