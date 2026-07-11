import type {
  AiGranularSettings,
  AiMode,
  AiQuietHours,
  CuuProactivity,
  DispatchPolicy
} from "@workhub/contracts";
import { DEFAULT_AI_QUIET_HOURS, DEFAULT_CUU_PROACTIVITY } from "@workhub/contracts";
import { and, eq, isNull } from "drizzle-orm";

import type { WorkHubDb } from "../client.js";
import {
  projectAiGovernance,
  projects,
  userAiProfiles,
  workspaceMemberships
} from "../schema/index.js";

export type UserAiProfileRow = typeof userAiProfiles.$inferSelect;
export type ProjectAiGovernanceRow = typeof projectAiGovernance.$inferSelect;
export type AiSettingsProjectRow = typeof projects.$inferSelect;

export type UserAiProfilePatch = {
  defaultMode?: AiMode;
  granularJson?: AiGranularSettings;
  dispatchPolicy?: DispatchPolicy;
  cuuProactivity?: CuuProactivity;
  modelTierPref?: string | null;
};

export type ProjectAiGovernancePatch = {
  observerEnabled?: boolean;
  silenceWindowSecs?: number;
  quietHoursJson?: AiQuietHours;
  granularJson?: AiGranularSettings;
};

export type FindUserProfileAccessInput = {
  workspaceId: string;
  userId: string;
};

export type UpsertUserProfileInput = FindUserProfileAccessInput & {
  patch: UserAiProfilePatch;
  at?: Date;
};

export type UserProfileAccessRecord = {
  membershipRole: string;
  profile: UserAiProfileRow | null;
};

export type FindProjectGovernanceAccessInput = {
  workspaceId: string;
  projectId: string;
  actorUserId: string;
};

export type UpsertProjectGovernanceInput = FindProjectGovernanceAccessInput & {
  patch: ProjectAiGovernancePatch;
  at?: Date;
};

export type ProjectGovernanceAccessRecord = {
  membershipRole: string;
  project: AiSettingsProjectRow;
  governance: ProjectAiGovernanceRow | null;
};

export type AiSettingsRepository = {
  findUserProfileAccessRecord: (
    input: FindUserProfileAccessInput
  ) => Promise<UserProfileAccessRecord | null>;
  upsertUserProfile: (input: UpsertUserProfileInput) => Promise<UserAiProfileRow>;
  findProjectGovernanceAccessRecord: (
    input: FindProjectGovernanceAccessInput
  ) => Promise<ProjectGovernanceAccessRecord | null>;
  upsertProjectGovernance: (
    input: UpsertProjectGovernanceInput
  ) => Promise<ProjectAiGovernanceRow>;
};

class NamedAiSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AiSettingsEmptyPatchError extends NamedAiSettingsError {}
export class AiSettingsInvalidPatchError extends NamedAiSettingsError {}
export class AiSettingsAccessDeniedError extends NamedAiSettingsError {}
export class AiSettingsWriteFailedError extends NamedAiSettingsError {}

const USER_PROFILE_PATCH_KEYS = [
  "defaultMode",
  "granularJson",
  "dispatchPolicy",
  "cuuProactivity",
  "modelTierPref"
] as const;

const PROJECT_GOVERNANCE_PATCH_KEYS = [
  "observerEnabled",
  "silenceWindowSecs",
  "quietHoursJson",
  "granularJson"
] as const;

const profileSelection = {
  workspaceId: userAiProfiles.workspaceId,
  userId: userAiProfiles.userId,
  defaultMode: userAiProfiles.defaultMode,
  granularJson: userAiProfiles.granularJson,
  dispatchPolicy: userAiProfiles.dispatchPolicy,
  cuuProactivity: userAiProfiles.cuuProactivity,
  modelTierPref: userAiProfiles.modelTierPref,
  createdAt: userAiProfiles.createdAt,
  updatedAt: userAiProfiles.updatedAt
};

const projectSelection = {
  id: projects.id,
  workspaceId: projects.workspaceId,
  name: projects.name,
  slug: projects.slug,
  description: projects.description,
  ownerNickname: projects.ownerNickname,
  ownerUserId: projects.ownerUserId,
  archived: projects.archived,
  deletedAt: projects.deletedAt,
  deletedByNickname: projects.deletedByNickname,
  nextSeq: projects.nextSeq,
  createdAt: projects.createdAt,
  updatedAt: projects.updatedAt
};

const governanceSelection = {
  projectId: projectAiGovernance.projectId,
  observerEnabled: projectAiGovernance.observerEnabled,
  silenceWindowSecs: projectAiGovernance.silenceWindowSecs,
  quietHoursJson: projectAiGovernance.quietHoursJson,
  granularJson: projectAiGovernance.granularJson,
  createdAt: projectAiGovernance.createdAt,
  updatedAt: projectAiGovernance.updatedAt
};

function assertPatch(
  patch: Record<string, unknown>,
  allowedKeys: readonly string[],
  label: string
) {
  const unknownKey = Object.keys(patch).find((key) => !allowedKeys.includes(key));
  if (unknownKey) {
    throw new AiSettingsInvalidPatchError(`${label} patch contains unknown field: ${unknownKey}`);
  }
  if (!allowedKeys.some((key) => patch[key] !== undefined)) {
    throw new AiSettingsEmptyPatchError(`${label} patch must include at least one defined field`);
  }
}

function profileInsertValues(input: UpsertUserProfileInput, at: Date) {
  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    defaultMode: input.patch.defaultMode ?? 3,
    granularJson: input.patch.granularJson ?? {},
    dispatchPolicy: input.patch.dispatchPolicy ?? "auto",
    cuuProactivity: input.patch.cuuProactivity ?? DEFAULT_CUU_PROACTIVITY,
    modelTierPref: input.patch.modelTierPref === undefined ? null : input.patch.modelTierPref,
    createdAt: at,
    updatedAt: at
  };
}

function profileUpdateValues(patch: UserAiProfilePatch, at: Date) {
  return {
    ...(patch.defaultMode !== undefined ? { defaultMode: patch.defaultMode } : {}),
    ...(patch.granularJson !== undefined ? { granularJson: patch.granularJson } : {}),
    ...(patch.dispatchPolicy !== undefined ? { dispatchPolicy: patch.dispatchPolicy } : {}),
    ...(patch.cuuProactivity !== undefined ? { cuuProactivity: patch.cuuProactivity } : {}),
    ...(patch.modelTierPref !== undefined ? { modelTierPref: patch.modelTierPref } : {}),
    updatedAt: at
  };
}

function governanceInsertValues(input: UpsertProjectGovernanceInput, at: Date) {
  return {
    projectId: input.projectId,
    observerEnabled: input.patch.observerEnabled ?? true,
    silenceWindowSecs: input.patch.silenceWindowSecs ?? 60,
    quietHoursJson: input.patch.quietHoursJson ?? { ...DEFAULT_AI_QUIET_HOURS },
    granularJson: input.patch.granularJson ?? {},
    createdAt: at,
    updatedAt: at
  };
}

function governanceUpdateValues(patch: ProjectAiGovernancePatch, at: Date) {
  return {
    ...(patch.observerEnabled !== undefined ? { observerEnabled: patch.observerEnabled } : {}),
    ...(patch.silenceWindowSecs !== undefined ? { silenceWindowSecs: patch.silenceWindowSecs } : {}),
    ...(patch.quietHoursJson !== undefined ? { quietHoursJson: patch.quietHoursJson } : {}),
    ...(patch.granularJson !== undefined ? { granularJson: patch.granularJson } : {}),
    updatedAt: at
  };
}

async function lockUserMembership(
  tx: WorkHubDb,
  input: FindUserProfileAccessInput
) {
  const [membership] = await tx
    .select({ membershipRole: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, input.workspaceId),
        eq(workspaceMemberships.userId, input.userId),
        isNull(workspaceMemberships.deletedAt)
      )
    )
    .for("share", { of: workspaceMemberships })
    .limit(1);
  return membership ?? null;
}

function activeProjectOwnerCondition(input: FindProjectGovernanceAccessInput) {
  return and(
    eq(projects.id, input.projectId),
    eq(projects.workspaceId, input.workspaceId),
    eq(projects.ownerUserId, input.actorUserId),
    eq(projects.archived, false),
    isNull(projects.deletedAt)
  );
}

function activeActorMembershipJoin(input: FindProjectGovernanceAccessInput) {
  return and(
    eq(workspaceMemberships.workspaceId, projects.workspaceId),
    eq(workspaceMemberships.workspaceId, input.workspaceId),
    eq(workspaceMemberships.userId, input.actorUserId),
    isNull(workspaceMemberships.deletedAt)
  );
}

async function lockProjectOwnerAccess(
  tx: WorkHubDb,
  input: FindProjectGovernanceAccessInput
) {
  const [project] = await tx
    .select(projectSelection)
    .from(projects)
    .where(activeProjectOwnerCondition(input))
    .for("share", { of: projects })
    .limit(1);
  if (!project) {
    return null;
  }

  const [membership] = await tx
    .select({ membershipRole: workspaceMemberships.role })
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, input.workspaceId),
        eq(workspaceMemberships.userId, input.actorUserId),
        isNull(workspaceMemberships.deletedAt)
      )
    )
    .for("share", { of: workspaceMemberships })
    .limit(1);
  return membership ? { membershipRole: membership.membershipRole, project } : null;
}

export function createAiSettingsRepository(db: WorkHubDb): AiSettingsRepository {
  return {
    async findUserProfileAccessRecord(input) {
      const [access] = await db
        .select({
          membershipRole: workspaceMemberships.role,
          profile: profileSelection
        })
        .from(workspaceMemberships)
        .leftJoin(
          userAiProfiles,
          and(
            eq(userAiProfiles.workspaceId, workspaceMemberships.workspaceId),
            eq(userAiProfiles.userId, workspaceMemberships.userId)
          )
        )
        .where(
          and(
            eq(workspaceMemberships.workspaceId, input.workspaceId),
            eq(workspaceMemberships.userId, input.userId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .limit(1);
      return access ?? null;
    },

    async upsertUserProfile(input) {
      assertPatch(
        input.patch as Record<string, unknown>,
        USER_PROFILE_PATCH_KEYS,
        "user AI profile"
      );
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        const membership = await lockUserMembership(tx, input);
        if (!membership) {
          throw new AiSettingsAccessDeniedError("active workspace membership is required for AI profile access");
        }
        const [written] = await tx
          .insert(userAiProfiles)
          .values(profileInsertValues(input, at))
          .onConflictDoUpdate({
            target: [userAiProfiles.workspaceId, userAiProfiles.userId],
            set: profileUpdateValues(input.patch, at)
          })
          .returning();
        if (!written) {
          throw new AiSettingsWriteFailedError("user AI profile upsert returned no row");
        }
        return written;
      });
    },

    async findProjectGovernanceAccessRecord(input) {
      const [access] = await db
        .select({
          membershipRole: workspaceMemberships.role,
          project: projectSelection,
          governance: governanceSelection
        })
        .from(projects)
        .innerJoin(workspaceMemberships, activeActorMembershipJoin(input))
        .leftJoin(projectAiGovernance, eq(projectAiGovernance.projectId, projects.id))
        .where(activeProjectOwnerCondition(input))
        .limit(1);
      return access ?? null;
    },

    async upsertProjectGovernance(input) {
      assertPatch(
        input.patch as Record<string, unknown>,
        PROJECT_GOVERNANCE_PATCH_KEYS,
        "project AI governance"
      );
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        const access = await lockProjectOwnerAccess(tx, input);
        if (!access) {
          throw new AiSettingsAccessDeniedError(
            "active project ownership and workspace membership are required for AI governance access"
          );
        }
        const [written] = await tx
          .insert(projectAiGovernance)
          .values(governanceInsertValues(input, at))
          .onConflictDoUpdate({
            target: projectAiGovernance.projectId,
            set: governanceUpdateValues(input.patch, at)
          })
          .returning();
        if (!written) {
          throw new AiSettingsWriteFailedError("project AI governance upsert returned no row");
        }
        return written;
      });
    }
  };
}
