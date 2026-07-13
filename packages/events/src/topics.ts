import { eventTopicSchema, type EventTopic, type TopicKind } from "@workhub/contracts";

const topic = (kind: TopicKind, id?: string): EventTopic => ({
  kind,
  topic: id ? `${kind}:${id}` : kind,
  ...(id ? { id } : {})
});

export const topics = {
  // 全局流按工作区隔离：传 workspaceId 得到 `all:<workspaceId>`（跨租户不互通）。
  // 不传参时退回历史的裸 `all`（单租户/旧调用方），兼容既有断言。
  all: (workspaceId?: string) => (workspaceId ? topic("all", workspaceId) : topic("all")),
  user: (id: string) => topic("user", id),
  workitem: (id: string) => topic("workitem", id),
  run: (id: string) => topic("run", id),
  session: (id: string) => topic("session", id),
  proposal: (id: string) => topic("proposal", id),
  job: (id: string) => topic("job", id),
  conversation: (id: string) => eventTopicSchema.parse(topic("conversation", id.toLowerCase()))
} as const;

export function parseTopic(rawTopic: string): EventTopic {
  if (rawTopic === "all") {
    return topics.all();
  }

  const splitAt = rawTopic.indexOf(":");
  if (splitAt <= 0 || splitAt === rawTopic.length - 1) {
    throw new Error(`Invalid WorkHub event topic: ${rawTopic}`);
  }

  const kind = rawTopic.slice(0, splitAt) as TopicKind;
  const id = rawTopic.slice(splitAt + 1);
  if (!["all", "user", "workitem", "run", "session", "proposal", "job", "conversation"].includes(kind)) {
    throw new Error(`Unknown WorkHub event topic kind: ${kind}`);
  }
  if (kind === "conversation") {
    return topics.conversation(id);
  }
  return topic(kind, id);
}
