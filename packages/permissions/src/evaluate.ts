import type { PermissionEffect } from "@workhub/contracts";

import type {
  PermissionActor,
  PermissionDecision,
  PermissionPolicyRecord,
  ToolLike
} from "./types.js";

const scopeRank = {
  org: 1,
  workspace: 2,
  role: 3,
  session: 4
} as const;

const effectRank: Record<PermissionEffect, number> = {
  allow: 1,
  ask: 2,
  deny: 3
};

type CandidateRank = {
  scope: number;
  priority: number;
  pattern: number;
};

function actionId(action: string | ToolLike) {
  return typeof action === "string" ? action : action.id;
}

function escapeRegExp(input: string) {
  return input.replace(/[\\^$+?.()|[\]{}]/g, "\\$&");
}

export function globMatch(pattern: string, value: string): boolean {
  const regex = new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`);
  return regex.test(value);
}

function patternSpecificity(pattern: string) {
  const literalChars = pattern.replaceAll("*", "").length;
  const wildcardPenalty = (pattern.match(/\*/g) ?? []).length;
  return literalChars * 10 - wildcardPenalty;
}

function isExpired(policy: PermissionPolicyRecord, now: Date) {
  if (!policy.expiresAt) {
    return false;
  }
  return new Date(policy.expiresAt).getTime() <= now.getTime();
}

function policyAppliesToActor(policy: PermissionPolicyRecord, actor: PermissionActor) {
  switch (policy.scopeKind) {
    case "org":
      return Boolean(actor.orgId && actor.orgId === policy.scopeId);
    case "workspace":
      return Boolean(actor.workspaceId && actor.workspaceId === policy.scopeId);
    case "role":
      return Boolean(actor.roleIds?.includes(policy.scopeId));
    case "session":
      return policy.scopeId === actor.sessionId || policy.scopeId === actor.id;
    default:
      return false;
  }
}

function isActivePolicy(policy: PermissionPolicyRecord, actor: PermissionActor, now: Date) {
  return policy.deletedAt == null && !isExpired(policy, now) && policyAppliesToActor(policy, actor);
}

function rankPolicy(policy: PermissionPolicyRecord): CandidateRank {
  return {
    scope: scopeRank[policy.scopeKind],
    priority: policy.priority ?? 0,
    pattern: patternSpecificity(policy.actionPattern)
  };
}

function sameRank(left: CandidateRank, right: CandidateRank) {
  return left.scope === right.scope && left.priority === right.priority && left.pattern === right.pattern;
}

function compareRank(left: CandidateRank, right: CandidateRank) {
  return left.scope - right.scope || left.priority - right.priority || left.pattern - right.pattern;
}

function strongestEffect(policies: readonly PermissionPolicyRecord[]): PermissionPolicyRecord {
  return [...policies].sort((left, right) => effectRank[right.effect] - effectRank[left.effect])[0] as PermissionPolicyRecord;
}

export function resolvePermissionDecision(
  actor: PermissionActor,
  action: string | ToolLike,
  policies: readonly PermissionPolicyRecord[],
  options: { now?: Date } = {}
): PermissionDecision {
  const actionPattern = actionId(action);
  const now = options.now ?? new Date();
  const consideredPolicies = policies.filter(
    (policy) => isActivePolicy(policy, actor, now) && globMatch(policy.actionPattern, actionPattern)
  );

  if (consideredPolicies.length === 0) {
    if (actor.isAdmin) {
      return {
        effect: "allow",
        actionPattern,
        reason: "admin action fallback",
        consideredPolicies
      };
    }
    return {
      effect: "ask",
      actionPattern,
      reason: "no matching policy",
      consideredPolicies
    };
  }

  const bestRank = consideredPolicies
    .map(rankPolicy)
    .sort((left, right) => compareRank(right, left))[0] as CandidateRank;
  const tied = consideredPolicies.filter((policy) => sameRank(rankPolicy(policy), bestRank));
  const matchedPolicy = strongestEffect(tied);

  return {
    effect: matchedPolicy.effect,
    actionPattern,
    ...(matchedPolicy.reason ? { reason: matchedPolicy.reason } : {}),
    matchedPolicy,
    consideredPolicies
  };
}

export function visibleTools<T extends ToolLike>(
  actor: PermissionActor,
  tools: readonly T[],
  policies: readonly PermissionPolicyRecord[],
  options: { now?: Date } = {}
): T[] {
  return tools.filter((tool) => resolvePermissionDecision(actor, tool, policies, options).effect !== "deny");
}
