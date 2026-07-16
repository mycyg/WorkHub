// WorkHub 桌面 · 军团面板从会话 SSE 流里识别 run 生命周期事件——纯函数，未过校验一律返回 false，
// 调用方(panel.ts)静默丢弃。
//
// R17 G3(#7)：服务端 emitRunEvent 现在把 run 的【状态级】生命周期事件(started/failed/escalated + 成功终态
// agent_run.step[kind:'done'])除了发 topics.run/topics.workitem，还双发到 run 血缘会话(source_conversation_id)
// 的 topic。军团会话情境面板订的正是这条会话流(chat/view.ts 把每条 SSE data 转发给 handleRawConversationEvent)——
// 收到这类事件即后台重拉对应会话的军团面板，让纯执行推进的 run 卡不再停在打开会话那一刻的旧快照。
// 逐 step 高频增量不会双发到会话流(见 agent-runner.ts 注释)，所以这里即便宽松匹配也不会被高频事件刷爆。
//
// 校验用 eventTypes 常量比对 + 窄字段守卫(desktop-webview 不直接依赖 zod，会话消息类事件也是走 contracts
// 已有 schema；run 生命周期事件目前没有对应 schema，这里做精确的最小类型守卫，不是松散地摸字段)。

import { eventTypes } from "@workhub/contracts";

type LooseEventEnvelope = {
  type: string;
  data: { run_id: string; kind?: unknown };
};

function isLooseRunEnvelope(raw: unknown): raw is LooseEventEnvelope {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const envelope = raw as { type?: unknown; data?: unknown };
  if (typeof envelope.type !== "string") {
    return false;
  }
  if (typeof envelope.data !== "object" || envelope.data === null) {
    return false;
  }
  return typeof (envelope.data as { run_id?: unknown }).run_id === "string";
}

// 判定一条会话流事件是不是 run 的状态级生命周期事件。started/failed/escalated 恒是；agent_run.step 只有
// kind==='done'(成功/失败终态)才算——中间步骤增量本就不会双发到会话流，这里再收一道，避免误判。
export function isIncomingAgentRunLifecycleEvent(raw: unknown): boolean {
  if (!isLooseRunEnvelope(raw)) {
    return false;
  }
  const { type, data } = raw;
  if (type === eventTypes.agentRunStarted || type === eventTypes.agentRunFailed || type === eventTypes.agentRunEscalated) {
    return true;
  }
  if (type === eventTypes.agentRunStep) {
    return data.kind === "done";
  }
  return false;
}
