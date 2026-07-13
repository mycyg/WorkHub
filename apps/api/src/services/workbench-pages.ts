import {
  createWorkbenchRepository,
  getSharedDatabaseClient,
  type WorkbenchRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import {
  workbenchPageVmSchema,
  type WorkbenchPageVM,
  type WorkHubLocale
} from "@workhub/contracts";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";
import {
  ConversationServiceError,
  getDefaultConversationService,
  type ConversationService
} from "./conversations.js";

type WorkbenchRepositorySources = Pick<
  WorkbenchRepository,
  "findWorkbenchAccess" | "listWorkspaceMembers" | "countVisibleActivePlans" | "listRecentVisibleFiles"
>;

export type WorkbenchPageServiceDependencies = {
  repo: WorkbenchRepositorySources;
  conversations: Pick<ConversationService, "listConversations">;
  now?: () => Date;
};

export type WorkbenchPageService = {
  page(input: {
    actor: AuthActor;
    projectId: string;
    locale?: WorkHubLocale;
  }): Promise<WorkbenchPageVM>;
};

export class WorkbenchPageServiceError extends Error {
  constructor(
    public readonly status: 404,
    public readonly code: "workbench_not_found",
    message: string
  ) {
    super(message);
    this.name = "WorkbenchPageServiceError";
  }
}

function workbenchNotFound(): WorkbenchPageServiceError {
  return new WorkbenchPageServiceError(404, "workbench_not_found", "没有找到这个桌面工作台。");
}

function humanScope(actor: AuthActor): { userId: string; workspaceId: string } {
  const userId = actor.userId?.trim().toLowerCase();
  const workspaceId = actor.workspaceId?.trim().toLowerCase();
  if (actor.kind !== "human" || !userId || !workspaceId) {
    throw workbenchNotFound();
  }
  return { userId, workspaceId };
}

export function createWorkbenchPageService(deps: WorkbenchPageServiceDependencies): WorkbenchPageService {
  const now = deps.now ?? (() => new Date());
  return {
    async page({ actor, projectId }) {
      const { userId, workspaceId } = humanScope(actor);
      const requestedProjectId = projectId.trim().toLowerCase();
      const access = await deps.repo.findWorkbenchAccess({
        workspaceId,
        viewerUserId: userId,
        projectId: requestedProjectId
      });
      if (!access) {
        throw workbenchNotFound();
      }
      const canonicalProjectId = access.project.id;
      const canonicalWorkspaceId = access.project.workspaceId;
      const canonicalActor: AuthActor = {
        ...actor,
        id: userId,
        userId,
        workspaceId: canonicalWorkspaceId
      };
      const canonicalAccessInput = {
        workspaceId: canonicalWorkspaceId,
        viewerUserId: userId,
        projectId: canonicalProjectId
      };

      const conversationRead = deps.conversations
        .listConversations({ actor: canonicalActor, projectId: canonicalProjectId, query: { limit: 50 } })
        .catch((error: unknown) => {
          if (error instanceof ConversationServiceError && (error.status === 403 || error.status === 404)) {
            throw workbenchNotFound();
          }
          throw error;
        });
      const [conversations, workspaceMembers, activePlanCount, recentFiles] = await Promise.all([
        conversationRead,
        deps.repo.listWorkspaceMembers({
          workspaceId: canonicalWorkspaceId,
          viewerUserId: userId,
          projectOwnerUserId: access.project.ownerUserId,
          limit: 100
        }),
        deps.repo.countVisibleActivePlans({
          workspaceId: canonicalWorkspaceId,
          projectId: canonicalProjectId,
          viewerUserId: userId,
          isAdmin: actor.isAdmin
        }),
        deps.repo.listRecentVisibleFiles({
          workspaceId: canonicalWorkspaceId,
          projectId: canonicalProjectId,
          viewerUserId: userId,
          isAdmin: actor.isAdmin,
          limit: 5
        })
      ]);

      const recheckedAccess = await deps.repo.findWorkbenchAccess(canonicalAccessInput);
      if (
        !recheckedAccess
        || recheckedAccess.project.id !== access.project.id
        || recheckedAccess.project.workspaceId !== access.project.workspaceId
        || recheckedAccess.project.ownerUserId !== access.project.ownerUserId
        || recheckedAccess.membershipRole !== access.membershipRole
      ) {
        throw workbenchNotFound();
      }

      return parseOutputContract(workbenchPageVmSchema, {
        generated_at: now().toISOString(),
        project: {
          id: access.project.id,
          workspace_id: access.project.workspaceId,
          name: access.project.name,
          slug: access.project.slug,
          description: access.project.description,
          owner_label: access.project.ownerNickname
        },
        viewer: {
          user_id: userId,
          membership_role: access.membershipRole,
          is_project_owner: access.project.ownerUserId === userId
        },
        conversations,
        workspace_members: {
          scope: "workspace",
          total: workspaceMembers.total,
          returned: workspaceMembers.returned,
          capped: workspaceMembers.capped,
          items: workspaceMembers.items.map((member) => ({
            user_id: member.userId,
            nickname: member.nickname,
            membership_role: member.membershipRole,
            is_project_owner: member.isProjectOwner,
            is_self: member.isSelf
          }))
        },
        army_summary: {
          active_plan_count: activePlanCount,
          ...(activePlanCount === 0 ? { empty_state: "no_active_armies" as const } : {})
        },
        recent_project_files: {
          items: recentFiles.map((file) => ({
            id: file.id,
            name: file.name,
            updated_at: file.updatedAt.toISOString(),
            href: `/drive?project_id=${encodeURIComponent(canonicalProjectId)}&item_id=${encodeURIComponent(file.id)}`
          })),
          ...(recentFiles.length === 0 ? { empty_state: "no_recent_files" as const } : {})
        }
      }, "workbench.page");
    }
  };
}

let defaultWorkbenchDbClient: WorkHubDatabaseClient | undefined;
let defaultWorkbenchPageService: WorkbenchPageService | undefined;

export function getDefaultWorkbenchPageService(): WorkbenchPageService {
  if (!defaultWorkbenchPageService) {
    defaultWorkbenchDbClient = getSharedDatabaseClient();
    defaultWorkbenchPageService = createWorkbenchPageService({
      repo: createWorkbenchRepository(defaultWorkbenchDbClient.db),
      conversations: getDefaultConversationService()
    });
  }
  return defaultWorkbenchPageService;
}
