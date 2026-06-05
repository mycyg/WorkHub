import { HTTPException } from "hono/http-exception";

import { topics } from "@workhub/events";

import type { StreamUser } from "../middleware/auth.js";

export type TopicAccessResolver = {
  canViewWorkItem?: (user: StreamUser, id: string) => Promise<boolean>;
  canViewRun?: (user: StreamUser, id: string) => Promise<boolean>;
  canViewSession?: (user: StreamUser, id: string) => Promise<boolean>;
  canViewProposal?: (user: StreamUser, id: string) => Promise<boolean>;
};

export type StreamTopicRequest =
  | { kind: "all" }
  | { kind: "me" }
  | { kind: "workitem"; id: string }
  | { kind: "run"; id: string }
  | { kind: "session"; id: string }
  | { kind: "proposal"; id: string };

export async function resolveAuthorizedTopic(
  user: StreamUser,
  request: StreamTopicRequest,
  access: TopicAccessResolver = {}
) {
  switch (request.kind) {
    case "all":
      return topics.all().topic;
    case "me":
      return topics.user(user.id).topic;
    case "workitem":
      if (await access.canViewWorkItem?.(user, request.id)) {
        return topics.workitem(request.id).topic;
      }
      throw new HTTPException(403, { message: "cannot stream this work item" });
    case "run":
      if (await access.canViewRun?.(user, request.id)) {
        return topics.run(request.id).topic;
      }
      throw new HTTPException(403, { message: "cannot stream this agent run" });
    case "session":
      if (await access.canViewSession?.(user, request.id)) {
        return topics.session(request.id).topic;
      }
      throw new HTTPException(403, { message: "cannot stream this session" });
    case "proposal":
      if (await access.canViewProposal?.(user, request.id)) {
        return topics.proposal(request.id).topic;
      }
      throw new HTTPException(403, { message: "cannot stream this proposal" });
  }
}
