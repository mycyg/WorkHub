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

// M25：达到此优先级的 deny 是「硬熔断」——跨 scope 强制阻断，压过任何更窄 scope 的 allow，连管理员也挡。
// 普通策略优先级远低于此（默认 0），故常规的 scope 优先解析对它们行为完全不变；只有管理员显式把某条 deny
// 提到此优先级，org/workspace 级紧急 kill-switch 才真正生效。仅对 deny 开此口子——跨 scope 的 allow 覆盖
// 风险更大（可能误授权），不允许越过 scope。
export const OVERRIDE_DENY_PRIORITY = 1000;

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
  // R4-HIGH（ReDoS）：相邻 `*` 会编译出相邻 `.*.*…`，对不匹配的长 value 触发灾难性回溯
  // （指数级，实测 8 个 `*` 即可让单次匹配挂 ~60s CPU）。用户可经 /ask 提交 action_pattern
  // 落成 session 级策略，之后每次权限判定都跑 globMatch → 可被用作 CPU DoS。
  // 修法：先把连续 `*` 折叠为单个——glob 语义下 `**` 与 `*` 等价（都匹配任意），
  // 折叠后正则里任意两个 `.*` 之间必有 ≥1 字面字符（或位于首尾），不再有相邻 `.*`，
  // 彻底消除回溯歧义；匹配语义逐字不变。
  // L25：'s'(dotAll) 让 `*` 也跨换行，否则含 \n 的 action 值能绕过 deny 通配
  // （如 "tool.x\ninjected" 不被 "tool.*" 匹配 → 漏过本应 deny 的动作）。
  const collapsed = pattern.replace(/\*+/g, "*");
  const regex = new RegExp(`^${collapsed.split("*").map(escapeRegExp).join(".*")}$`, "s");
  return regex.test(value);
}

function patternSpecificity(pattern: string) {
  const literalChars = pattern.replaceAll("*", "").length;
  const wildcardPenalty = (pattern.match(/\*/g) ?? []).length;
  return literalChars * 10 - wildcardPenalty;
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

// findings[#12]：去掉 isExpired/expiresAt TTL 死代码——permission_policies 没有 expires_at 列、expiresAt 从未被
// 写入，isExpired 恒为 false，徒增「策略会过期」的误导。仅按软删 + scope 适配判活。
function isActivePolicy(policy: PermissionPolicyRecord, actor: PermissionActor) {
  return policy.deletedAt == null && policyAppliesToActor(policy, actor);
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
  const consideredPolicies = policies.filter(
    (policy) => isActivePolicy(policy, actor) && globMatch(policy.actionPattern, actionPattern)
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

  // M25：硬熔断先于常规 scope 解析——任何达到 OVERRIDE_DENY_PRIORITY 的 deny 跨 scope 强制阻断，
  // 即便存在更窄 scope（role/session）的 allow，也即便 actor 是管理员。这让 org/workspace 级紧急 deny
  // 真正生效（此前 scope 优先 → 宽 deny 永远压不过窄 allow，kill-switch 形同虚设）。
  const overrideDenies = consideredPolicies.filter(
    (policy) => policy.effect === "deny" && (policy.priority ?? 0) >= OVERRIDE_DENY_PRIORITY
  );
  if (overrideDenies.length > 0) {
    const matchedPolicy = [...overrideDenies].sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))[0] as PermissionPolicyRecord;
    return {
      effect: "deny",
      actionPattern,
      ...(matchedPolicy.reason ? { reason: matchedPolicy.reason } : {}),
      matchedPolicy,
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
