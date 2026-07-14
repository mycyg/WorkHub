import {
  teamSkillManagementItemVmSchema,
  teamSkillManagementPageVmSchema,
  type SkillEditPatch,
  type TeamSkillManagementItemVM,
  type TeamSkillManagementPageVM,
  type TeamSkillVM
} from "@workhub/contracts";
import {
  createAuditLogRepository,
  createTeamSkillRepository,
  getSharedDatabaseClient,
  type AuditLogRepository,
  type TeamSkillRepository,
  type TeamSkillRow,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { getDefaultStructuredLogger } from "../logging.js";
import { parseOutputContract } from "../pages/output-contract.js";
import { validateSkillEditPatch } from "./skill-curation.js";

// R14 批 MEM（记忆可见可治理）：团队技能治理管理面服务——列表/详情（全员可读）+ 编辑/停用（仅管理员）。
// 编辑走 K2 受限编辑补丁（逐字复用 validateSkillEditPatch + promote 生成新版本），停用复用 deprecate 幂等。
// 语义红线见 03-mem-design §2.2/§3.2。管理员判定=actor.isAdmin（users 全局布尔列），**不是**
// workspace_memberships.role（那是目前无权限判定读它的摆设字段，§5）。

export class TeamSkillGovernanceServiceError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "TeamSkillGovernanceServiceError";
  }
}

export type TeamSkillGovernanceServiceDependencies = {
  repository: Pick<TeamSkillRepository, "listForWorkspace" | "getById" | "promote" | "deprecate">;
  auditLog: Pick<AuditLogRepository, "createAuditLog">;
  now?: () => Date;
};

export type TeamSkillGovernanceService = {
  listSkills(input: { actor: AuthActor }): Promise<TeamSkillManagementPageVM>;
  getSkill(input: { actor: AuthActor; id: string }): Promise<TeamSkillManagementItemVM>;
  patchSkill(input: {
    actor: AuthActor;
    id: string;
    ops: SkillEditPatch["ops"];
    baseVersion: number;
    rationaleMd?: string;
  }): Promise<TeamSkillManagementItemVM>;
  deactivateSkill(input: { actor: AuthActor; id: string; reason?: string }): Promise<{ deprecated: true }>;
};

type AdminScope = { userId: string; workspaceId: string };

function requireAdmin(actor: AuthActor): AdminScope {
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId || !actor.isAdmin) {
    throw new TeamSkillGovernanceServiceError(
      403,
      "team_skill_admin_required",
      "只有管理员可以编辑或停用团队技能。"
    );
  }
  return { userId, workspaceId: actor.workspaceId };
}

function confidenceFields(score: number | null): { confidence_score?: number } {
  // confidenceScore 是 doublePrecision，越界/NaN 会撞 min(0).max(1) schema——夹紧，非有限值跳过该字段。
  if (score === null || score === undefined) {
    return {};
  }
  const value = Number(score);
  if (!Number.isFinite(value)) {
    return {};
  }
  return { confidence_score: Math.min(1, Math.max(0, value)) };
}

// K2 精修 provenance（refined_from_version + op_count + rationale）——照抄 pages/team-skills.ts:18-34 的
// provenanceFrom（该函数未导出且在本工包围栏外，故复制而非 import；设计 §2.3 允许「照抄这段」）。
function refineProvenanceFrom(samplesJson: unknown): TeamSkillVM["provenance"] {
  if (!samplesJson || typeof samplesJson !== "object") {
    return undefined;
  }
  const record = samplesJson as Record<string, unknown>;
  const refinedFrom = record["refined_from_version"];
  if (typeof refinedFrom !== "number" || !Number.isInteger(refinedFrom) || refinedFrom < 1) {
    return undefined;
  }
  const ops = Array.isArray(record["ops"]) ? record["ops"] : [];
  const rationale = record["rationale_md"];
  return {
    refined_from_version: refinedFrom,
    op_count: ops.length,
    ...(typeof rationale === "string" && rationale ? { rationale_md: rationale } : {})
  };
}

function toManagementItem(row: TeamSkillRow): TeamSkillManagementItemVM {
  const provenance = refineProvenanceFrom(row.samplesJson);
  return {
    skill_key: row.skillKey,
    name: row.name,
    when_to_use: row.whenToUse,
    version: row.version,
    source_kind: row.sourceKind,
    created_by_kind: row.createdByKind,
    ...confidenceFields(row.confidenceScore),
    sample_count: row.sampleCount,
    updated_at: row.updatedAt.toISOString(),
    ...(provenance ? { provenance } : {}),
    id: row.id,
    content_md: row.contentMd,
    status: row.status,
    ...(row.deprecatedReason ? { deprecated_reason: row.deprecatedReason } : {}),
    ...(row.deprecatedAt ? { deprecated_at: row.deprecatedAt.toISOString() } : {}),
    ...(row.sourceRunId ? { source_run_id: row.sourceRunId } : {})
  };
}

// validateSkillEditPatch 的失败原因 → 人话（stale_base_version 单独走 409，其余 400）。
const EDIT_REASON_MESSAGE: Record<string, string> = {
  no_ops_applied: "没有一个编辑操作能应用到当前正文（段落不存在或已存在）。",
  no_effective_change: "编辑后的正文与当前版本完全一致，未产生改动。",
  invalid_frontmatter: "编辑后的技能缺少合法的 frontmatter（name / when_to_use）。",
  too_short: "编辑后的技能正文过短。",
  exceeds_size_budget: "编辑后的技能正文超过体积上限。",
  conflict_markers: "编辑后的正文包含 git 冲突标记。",
  injection_phrasing: "编辑后的正文包含可能干扰 AI 的指令式措辞。",
  low_confidence: "编辑补丁未达置信度门槛。"
};

export function createTeamSkillGovernanceService(
  deps: TeamSkillGovernanceServiceDependencies
): TeamSkillGovernanceService {
  const clock = deps.now ?? (() => new Date());

  async function writeAudit(input: Parameters<typeof deps.auditLog.createAuditLog>[0]): Promise<void> {
    try {
      await deps.auditLog.createAuditLog(input);
    } catch (error) {
      getDefaultStructuredLogger().warn("team_skill_governance_audit_write_failed", {
        action: input.action,
        entityId: input.entityId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    async listSkills({ actor }) {
      const rows = await deps.repository.listForWorkspace(actor.workspaceId);
      return parseOutputContract(
        teamSkillManagementPageVmSchema,
        {
          generated_at: clock().toISOString(),
          skills: rows.map(toManagementItem)
        },
        "team-skill-governance.page"
      );
    },

    async getSkill({ actor, id }) {
      const row = await deps.repository.getById(actor.workspaceId, id);
      if (!row) {
        throw new TeamSkillGovernanceServiceError(404, "team_skill_not_found", "没有找到这个团队技能。");
      }
      return parseOutputContract(teamSkillManagementItemVmSchema, toManagementItem(row), "team-skill-governance.item");
    },

    async patchSkill({ actor, id, ops, baseVersion, rationaleMd }) {
      const scope = requireAdmin(actor);
      const row = await deps.repository.getById(scope.workspaceId, id);
      if (!row) {
        throw new TeamSkillGovernanceServiceError(404, "team_skill_not_found", "没有找到这个团队技能。");
      }
      // 历史版本（deprecated/draft）只读——要改只能改当前激活版本，产生新版本（§3.2）。
      if (row.status !== "active") {
        throw new TeamSkillGovernanceServiceError(404, "team_skill_not_editable", "只能编辑当前激活的技能版本。");
      }
      const rationale = rationaleMd?.trim() || "管理员手动编辑";
      // 组装完整 SkillEditPatch：confidence_score 硬编码为 1（人工编辑无「置信度」概念，给满分让它必过门槛，
      // 不为人类编辑单造校验函数）；skill_key 从 URL 对应行取。
      const patch: SkillEditPatch = {
        skill_key: row.skillKey,
        base_version: baseVersion,
        ops,
        rationale_md: rationale,
        confidence_score: 1
      };
      // 逐字复用 K2 自验：base_version 校验 / 应用非空 / 防空转 / frontmatter / 体积上限 / 冲突标记 /
      // looksLikeInjection——七道闸门一次拿到，人工与 AI 编辑走同一底线。
      const validation = validateSkillEditPatch(patch, {
        activeVersion: row.version,
        currentContentMd: row.contentMd
      });
      if (!validation.ok) {
        if (validation.reason === "stale_base_version") {
          throw new TeamSkillGovernanceServiceError(
            409,
            "team_skill_base_version_conflict",
            "这个技能已有更新版本，请基于最新版本重新编辑。"
          );
        }
        throw new TeamSkillGovernanceServiceError(
          400,
          `team_skill_edit_${validation.reason}`,
          EDIT_REASON_MESSAGE[validation.reason] ?? "这个编辑补丁未通过校验。"
        );
      }
      const appliedOps = validation.appliedOps.filter((entry) => entry.status === "applied").map((entry) => entry.op);
      // promote 生成新版本：createdByKind=human；sourceKind 保留原值（内容血统不因人改就谎称原创）；
      // samplesJson 照抄 K2 写法 + edited_by_user_id 区分人工/AI 精修（前端据此判断，不需要新列）。
      const promoted = await deps.repository.promote({
        workspaceId: scope.workspaceId,
        skillKey: row.skillKey,
        name: row.name,
        whenToUse: row.whenToUse,
        contentMd: validation.contentMd,
        confidenceScore: 1,
        sampleCount: 0,
        sourceKind: row.sourceKind,
        createdByKind: "human",
        samplesJson: {
          refined_from_version: row.version,
          ops: appliedOps,
          rationale_md: rationale,
          edited_by_user_id: scope.userId
        }
      });
      await writeAudit({
        workspaceId: scope.workspaceId,
        actorKind: "human",
        actorUserId: scope.userId,
        actorNickname: actor.label,
        entityType: "team_skill",
        entityId: promoted.id,
        action: "team_skill.manually_edited",
        detailJson: {
          skill_key: row.skillKey,
          from_version: row.version,
          to_version: promoted.version,
          op_count: appliedOps.length,
          rationale_md: rationale
        }
      });
      return parseOutputContract(teamSkillManagementItemVmSchema, toManagementItem(promoted), "team-skill-governance.item");
    },

    async deactivateSkill({ actor, id, reason }) {
      const scope = requireAdmin(actor);
      const row = await deps.repository.getById(scope.workspaceId, id);
      if (!row) {
        throw new TeamSkillGovernanceServiceError(404, "team_skill_not_found", "没有找到这个团队技能。");
      }
      // 幂等：已 deprecated 直接返回现状（不报 409）——参考 CHAT 批幂等收尾口径（§3.2 表格括注）。
      if (row.status === "deprecated") {
        return { deprecated: true };
      }
      const effectiveReason = reason?.trim() || `由 ${actor.label} 手动停用`;
      await deps.repository.deprecate(scope.workspaceId, id, effectiveReason, clock());
      // deprecate 落空只可能是读到写之间被并发停用（已在上面拦了 deprecated），仍幂等成功。
      await writeAudit({
        workspaceId: scope.workspaceId,
        actorKind: "human",
        actorUserId: scope.userId,
        actorNickname: actor.label,
        entityType: "team_skill",
        entityId: row.id,
        action: "team_skill.manually_deprecated",
        detailJson: { skill_key: row.skillKey, version: row.version, reason: effectiveReason }
      });
      return { deprecated: true };
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: TeamSkillGovernanceService | undefined;

export function getDefaultTeamSkillGovernanceService(): TeamSkillGovernanceService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createTeamSkillGovernanceService({
      repository: createTeamSkillRepository(defaultDbClient.db),
      auditLog: createAuditLogRepository(defaultDbClient.db)
    });
  }
  return defaultService;
}
