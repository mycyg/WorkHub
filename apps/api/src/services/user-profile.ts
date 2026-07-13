import {
  userProfileVmSchema,
  type PatchUserProfileRequest,
  type UserProfileVM
} from "@workhub/contracts";
import {
  createUserProfileRepository,
  getSharedDatabaseClient,
  type UserProfileRepository,
  type UserProfileRow,
  type WorkHubDatabaseClient
} from "@workhub/db";

import type { AuthActor } from "../middleware/auth.js";
import { parseOutputContract } from "../pages/output-contract.js";

// R13 批 A2（派人推荐 v2）：GET/PATCH /me/profile ——"我是谁"（个人资料：职位头衔/简介/技能标签），
// 与既有 PATCH /me/ai-profile（"AI 该怎么替我干活"）语义分开，不混表不混端点。user_profiles 在本批
// 之前是零接线死表，这是它的第一个服务层实现。

export class UserProfileServiceError extends Error {
  constructor(
    public readonly status: 403,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "UserProfileServiceError";
  }
}

type HumanProfileActor = {
  actor: AuthActor;
  userId: string;
};

export type UserProfileServiceDependencies = {
  repository: UserProfileRepository;
  now?: () => Date;
};

export type UserProfileService = {
  getMyProfile(input: { actor: AuthActor }): Promise<UserProfileVM>;
  patchMyProfile(input: {
    actor: AuthActor;
    payload: PatchUserProfileRequest;
  }): Promise<UserProfileVM>;
};

function requireHumanActor(actor: AuthActor): HumanProfileActor {
  const userId = actor.userId?.trim();
  if (actor.kind !== "human" || !userId) {
    throw new UserProfileServiceError(
      403,
      "user_profile_access_denied",
      "需要已登录的真人用户才能访问个人资料。"
    );
  }
  return { actor, userId };
}

function profileView(human: HumanProfileActor, row: UserProfileRow | null): UserProfileVM {
  return parseOutputContract(userProfileVmSchema, {
    user_id: human.userId,
    nickname: human.actor.label,
    title: row?.title ?? null,
    bio_md: row?.bioMd ?? null,
    skill_tags: row?.skillTags ?? [],
    onboarded_at: row?.onboardedAt ? row.onboardedAt.toISOString() : null
  }, "user-profile.profile");
}

export function createUserProfileService(deps: UserProfileServiceDependencies): UserProfileService {
  return {
    async getMyProfile({ actor }) {
      const human = requireHumanActor(actor);
      const row = await deps.repository.findByUserId(human.userId);
      return profileView(human, row);
    },

    async patchMyProfile({ actor, payload }) {
      const human = requireHumanActor(actor);
      const at = (deps.now ?? (() => new Date()))();
      const written = await deps.repository.upsert({
        userId: human.userId,
        patch: {
          ...(payload.title !== undefined ? { title: payload.title } : {}),
          ...(payload.bio_md !== undefined ? { bioMd: payload.bio_md } : {}),
          ...(payload.skill_tags !== undefined ? { skillTags: [...payload.skill_tags] } : {})
        },
        at
      });
      return profileView(human, written);
    }
  };
}

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultUserProfileService: UserProfileService | undefined;

export function getDefaultUserProfileService(): UserProfileService {
  if (!defaultUserProfileService) {
    defaultDbClient = getSharedDatabaseClient();
    defaultUserProfileService = createUserProfileService({
      repository: createUserProfileRepository(defaultDbClient.db)
    });
  }
  return defaultUserProfileService;
}
