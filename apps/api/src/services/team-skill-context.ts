import {
  createDatabaseClient,
  createTeamSkillRepository,
  createWorkItemRepository,
  type TeamSkillRepository,
  type WorkItemDataRepository,
  type WorkHubDatabaseClient
} from "@workhub/db";
import { formatSkillCatalog, listSkills, type TeamSkillContentMap } from "@workhub/tools";

// 注入 worker 的团队技能包：
// - catalogAppendix：追加到 system prompt 技能目录的团队技能行（已排除与 FS 预设同名者）
// - contentByKey：load_skill 可直接命中的团队技能全文
export type TeamSkillBundle = {
  catalogAppendix: string;
  contentByKey: TeamSkillContentMap;
};

export type TeamSkillContextProvider = (run: { work_item_id: string }) => Promise<TeamSkillBundle | undefined>;

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultRepository: TeamSkillRepository | undefined;
let defaultWorkItems: WorkItemDataRepository | undefined;

function getRepositories(): { repo: TeamSkillRepository; workItems: WorkItemDataRepository } {
  defaultDbClient = defaultDbClient ?? createDatabaseClient();
  defaultRepository = defaultRepository ?? createTeamSkillRepository(defaultDbClient.db);
  defaultWorkItems = defaultWorkItems ?? createWorkItemRepository(defaultDbClient.db);
  return { repo: defaultRepository, workItems: defaultWorkItems };
}

// 默认提供者：work_item → workspace → 该工作空间的 active 团队技能。失败静默降级（返回 undefined → 退回纯 FS 视图）。
export function getDefaultTeamSkillContextProvider(): TeamSkillContextProvider {
  return async (run) => {
    try {
      const { repo, workItems } = getRepositories();
      const workItem = await workItems.findWorkItemById(run.work_item_id);
      const workspaceId = workItem?.workspaceId;
      if (!workspaceId) {
        return undefined;
      }
      const active = await repo.listActive(workspaceId);
      if (active.length === 0) {
        return undefined;
      }
      // FS 预设已在 system prompt 目录里列过，团队同名的不再重复列（内容上 FS 优先）。
      const presetIds = new Set(listSkills().map((skill) => skill.id));
      const team = active.filter((row) => !presetIds.has(row.skillKey));
      if (team.length === 0) {
        return undefined;
      }
      const catalogAppendix = formatSkillCatalog(
        team.map((row) => ({
          id: row.skillKey,
          name: row.name,
          description: row.whenToUse,
          whenToUse: row.whenToUse
        }))
      );
      const contentByKey: TeamSkillContentMap = {};
      for (const row of team) {
        contentByKey[row.skillKey] = row.contentMd;
      }
      return { catalogAppendix, contentByKey };
    } catch {
      return undefined;
    }
  };
}
