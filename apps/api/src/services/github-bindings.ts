import { settings as defaultSettings } from "@workhub/config";
import {
  githubBindingStatusVmSchema,
  githubTestConnectionResultSchema,
  type GithubBindingRequest,
  type GithubBindingStatusVM,
  type GithubTestConnectionRequest,
  type GithubTestConnectionResult
} from "@workhub/contracts";
import {
  createGithubBindingRepository,
  getSharedDatabaseClient,
  GithubBindingAccessDeniedError,
  type GithubBindingRepository,
  type GithubBindingRow,
  type GithubBindingProjectRow,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { canViewProjectDrive } from "@workhub/permissions";

import { getDefaultStructuredLogger, type StructuredLogger } from "../logging.js";
import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import {
  createGithubClient,
  humanizeGithubError,
  type GithubClient,
  type GithubRepoInfo
} from "./github-client.js";
import { createSecretBox, type SecretBox } from "./secret-box.js";

// R14 批 GH（07-gh-design.md §3）：项目级 GitHub 绑定服务。
// 权限收口：读状态=canViewProjectDrive（项目可见者，团队协作透明度）；写（绑定/换 PAT/解绑/测试）
// =严格 project owner（照 ai-governance 同一收紧程度，仓库层 owner 条件再兜一次底）。
// 安全红线（§6）：PAT 明文只在 upsert/test 两个调用栈内瞬时存在；日志只打显式挑选的字段
// （project_id/repo），绝不整对象序列化；响应 VM 在 contracts 层结构性无 token 字段；
// 未配置加密密钥时 503 fail-closed，绝不明文兜底落库。

const ACTIVITY_WINDOW_7D_MS = 7 * 24 * 60 * 60 * 1000;

export class GithubBindingServiceError extends Error {
  constructor(
    public readonly status: 403 | 404 | 422 | 503,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "GithubBindingServiceError";
  }
}

type HumanGithubActor = {
  actor: AuthActor;
  userId: string;
  workspaceId: string;
};

export type GithubBindingsServiceDependencies = {
  repository: GithubBindingRepository;
  client: Pick<GithubClient, "getRepo">;
  // undefined = GITHUB_TOKEN_ENC_KEY 未配置：所有需要触碰 PAT 的操作 503 fail-closed。
  secretBox?: SecretBox;
  logger?: StructuredLogger;
  now?: () => Date;
};

export type GithubBindingsService = {
  getBindingStatus(input: { actor: AuthActor; projectId: string }): Promise<GithubBindingStatusVM>;
  upsertBinding(input: {
    actor: AuthActor;
    projectId: string;
    payload: GithubBindingRequest;
  }): Promise<{ status: GithubBindingStatusVM; created: boolean }>;
  deleteBinding(input: { actor: AuthActor; projectId: string }): Promise<void>;
  testConnection(input: {
    actor: AuthActor;
    projectId: string;
    payload: GithubTestConnectionRequest;
  }): Promise<GithubTestConnectionResult>;
};

function accessDenied(): GithubBindingServiceError {
  return new GithubBindingServiceError(
    403,
    "github_binding_access_denied",
    "需要已加入工作区的真人用户才能管理 GitHub 绑定。"
  );
}

function projectNotFound(): GithubBindingServiceError {
  return new GithubBindingServiceError(
    404,
    "github_binding_project_not_found",
    "没有找到可访问的项目。"
  );
}

function ownerRequired(): GithubBindingServiceError {
  return new GithubBindingServiceError(
    403,
    "github_binding_owner_required",
    "只有项目负责人可以管理 GitHub 绑定。"
  );
}

function encryptionUnconfigured(): GithubBindingServiceError {
  return new GithubBindingServiceError(
    503,
    "github_binding_encryption_unconfigured",
    "GitHub 集成未配置加密密钥（GITHUB_TOKEN_ENC_KEY），请参考部署文档生成后重启服务。"
  );
}

function connectionRejected(reason: string): GithubBindingServiceError {
  return new GithubBindingServiceError(
    422,
    "github_binding_connection_failed",
    `GitHub 连接验证失败：${reason}`
  );
}

function requireHumanActor(actor: AuthActor): HumanGithubActor {
  const userId = actor.userId?.trim();
  const workspaceId = actor.workspaceId.trim();
  if (actor.kind !== "human" || !userId || !workspaceId) {
    throw accessDenied();
  }
  return { actor, userId, workspaceId };
}

function projectAccessRecord(project: GithubBindingProjectRow) {
  return {
    archived: project.archived,
    deletedAt: project.deletedAt,
    ownerUserId: project.ownerUserId,
    workspaceId: project.workspaceId,
    orgId: null
  };
}

export function createGithubBindingsService(
  deps: GithubBindingsServiceDependencies
): GithubBindingsService {
  const logger = deps.logger ?? getDefaultStructuredLogger();
  const currentTime = deps.now ?? (() => new Date());

  function requireSecretBox(): SecretBox {
    if (!deps.secretBox) {
      throw encryptionUnconfigured();
    }
    return deps.secretBox;
  }

  // 读口径：项目可见者皆可读绑定状态；项目不存在/不可见统一 404（不泄漏存在性）。
  async function readVisibleProject(actor: AuthActor, projectId: string) {
    requireHumanActor(actor);
    const record = await deps.repository.findProjectWithBinding(projectId);
    if (!record || !canViewProjectDrive(projectAccessRecord(record.project), actor)) {
      throw projectNotFound();
    }
    return record;
  }

  // 写口径：先按可见性给 404（藏存在性），再按严格 owner 给 403（可见但非负责人）。
  async function readOwnerAccess(actor: AuthActor, projectId: string) {
    const human = requireHumanActor(actor);
    await readVisibleProject(actor, projectId);
    const access = await deps.repository.findBindingOwnerAccessRecord({
      workspaceId: human.workspaceId,
      projectId,
      actorUserId: human.userId
    });
    if (!access) {
      throw ownerRequired();
    }
    return { human, access };
  }

  async function buildStatusView(
    projectId: string,
    binding: GithubBindingRow | null
  ): Promise<GithubBindingStatusVM> {
    const view = binding
      ? {
          project_id: projectId,
          bound: true,
          repo_full_name: binding.repoFullName,
          enabled: binding.enabled,
          ...(binding.lastSyncedAt ? { last_synced_at: binding.lastSyncedAt.toISOString() } : {}),
          ...(binding.lastError ? { last_error: binding.lastError } : {}),
          ...(binding.lastErrorAt ? { last_error_at: binding.lastErrorAt.toISOString() } : {}),
          activity_count_7d: await deps.repository.countActivitiesSince(
            projectId,
            new Date(currentTime().getTime() - ACTIVITY_WINDOW_7D_MS)
          )
        }
      : { project_id: projectId, bound: false };
    return parseOutputContract(githubBindingStatusVmSchema, view, "github-bindings.status");
  }

  async function verifyConnection(repoFullName: string, pat: string): Promise<GithubRepoInfo> {
    try {
      const result = await deps.client.getRepo(repoFullName, pat);
      return result.repo;
    } catch (error) {
      // 人话原因（humanizeGithubError 从不携带 token）；网络/HTTP 细节留给结构化日志（同样无 token）。
      logger.warn("github_binding_connection_check_failed", {
        repo_full_name: repoFullName,
        reason: humanizeGithubError(error)
      });
      throw connectionRejected(humanizeGithubError(error));
    }
  }

  return {
    async getBindingStatus({ actor, projectId }) {
      const record = await readVisibleProject(actor, projectId);
      return buildStatusView(projectId, record.binding);
    },

    async upsertBinding({ actor, projectId, payload }) {
      const secretBox = requireSecretBox();
      const { human, access } = await readOwnerAccess(actor, projectId);
      // 绑定前必须先真连 GitHub 验证能读 repo：失败 422，不写入任何行（同步校验，立刻知道对错）。
      await verifyConnection(payload.repo_full_name, payload.personal_access_token);
      const sealed = secretBox.seal(payload.personal_access_token);
      let written: GithubBindingRow;
      try {
        written = await deps.repository.upsertBinding({
          workspaceId: human.workspaceId,
          projectId,
          actorUserId: human.userId,
          repoFullName: payload.repo_full_name,
          patCiphertext: sealed.ciphertext,
          patIv: sealed.iv,
          patAuthTag: sealed.authTag,
          at: currentTime()
        });
      } catch (error) {
        if (error instanceof GithubBindingAccessDeniedError) {
          throw ownerRequired();
        }
        throw error;
      }
      // 显式挑字段打日志——绝不序列化 binding 整行（密文列也不进日志，红线 §6-1）。
      logger.info("github_binding_saved", {
        project_id: projectId,
        repo_full_name: written.repoFullName,
        rebound: access.binding !== null
      });
      return {
        status: await buildStatusView(projectId, written),
        created: access.binding === null
      };
    },

    async deleteBinding({ actor, projectId }) {
      // 解绑不需要加密密钥（密钥丢失时也要能销毁密文行），只需 owner 权限。
      const { human } = await readOwnerAccess(actor, projectId);
      let removed: boolean;
      try {
        removed = await deps.repository.deleteBinding({
          workspaceId: human.workspaceId,
          projectId,
          actorUserId: human.userId
        });
      } catch (error) {
        if (error instanceof GithubBindingAccessDeniedError) {
          throw ownerRequired();
        }
        throw error;
      }
      if (!removed) {
        throw new GithubBindingServiceError(
          404,
          "github_binding_not_found",
          "该项目尚未绑定 GitHub 仓库。"
        );
      }
      logger.info("github_binding_removed", { project_id: projectId });
    },

    async testConnection({ actor, projectId, payload }) {
      const { access } = await readOwnerAccess(actor, projectId);
      let repoFullName: string;
      let pat: string;
      if (payload.personal_access_token) {
        // 表单场景：验证临时 PAT（不落库、函数返回后不持有引用）。repo 取 body 或已存绑定。
        const candidateRepo = payload.repo_full_name ?? access.binding?.repoFullName;
        if (!candidateRepo) {
          throw new GithubBindingServiceError(
            422,
            "github_binding_repo_required",
            "测试临时 PAT 时需要提供 repo_full_name。"
          );
        }
        repoFullName = candidateRepo;
        pat = payload.personal_access_token;
      } else {
        // 重测场景：解出已存 PAT（只在本调用栈内瞬时存在）。
        if (!access.binding) {
          throw new GithubBindingServiceError(
            404,
            "github_binding_not_found",
            "该项目尚未绑定 GitHub 仓库，请先提供 PAT。"
          );
        }
        const secretBox = requireSecretBox();
        repoFullName = payload.repo_full_name ?? access.binding.repoFullName;
        pat = secretBox.open({
          ciphertext: access.binding.patCiphertext,
          iv: access.binding.patIv,
          authTag: access.binding.patAuthTag
        });
      }
      // 连接失败是正常业务结果（ok:false），不是 HTTP 层错误；两种用法都不触碰轮询水位（§3.2）。
      try {
        const result = await deps.client.getRepo(repoFullName, pat);
        return parseOutputContract(githubTestConnectionResultSchema, {
          ok: true,
          repo_full_name: result.repo.full_name,
          ...(result.repo.default_branch ? { repo_default_branch: result.repo.default_branch } : {}),
          ...(result.repo.private !== undefined ? { repo_private: result.repo.private } : {})
        }, "github-bindings.test-connection");
      } catch (error) {
        return parseOutputContract(githubTestConnectionResultSchema, {
          ok: false,
          error: humanizeGithubError(error)
        }, "github-bindings.test-connection");
      }
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultService: GithubBindingsService | undefined;

export function getDefaultGithubBindingsService(): GithubBindingsService {
  if (!defaultService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultService = createGithubBindingsService({
      repository: createGithubBindingRepository(defaultDbClient.db),
      client: createGithubClient(),
      // 未配置=undefined → 触碰 PAT 的操作 503 fail-closed；配置错误（非 32 字节）在这里显式抛错，
      // 宁可启动失败也不静默降级（07-gh-design 验收 1/9）。
      ...(defaultSettings.github.tokenEncKey
        ? { secretBox: createSecretBox(defaultSettings.github.tokenEncKey) }
        : {})
    });
  }
  return defaultService;
}
