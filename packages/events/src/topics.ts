import type { EventTopic, TopicKind } from "@workhub/contracts";

const topic = (kind: TopicKind, id?: string): EventTopic => ({
  kind,
  topic: id ? `${kind}:${id}` : kind,
  ...(id ? { id } : {})
});

export const topics = {
  all: () => topic("all"),
  user: (id: string) => topic("user", id),
  workitem: (id: string) => topic("workitem", id),
  run: (id: string) => topic("run", id),
  session: (id: string) => topic("session", id),
  proposal: (id: string) => topic("proposal", id),
  job: (id: string) => topic("job", id)
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
  if (!["user", "workitem", "run", "session", "proposal", "job"].includes(kind)) {
    throw new Error(`Unknown WorkHub event topic kind: ${kind}`);
  }
  return topic(kind, id);
}
