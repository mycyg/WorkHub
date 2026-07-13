// R13 批 A2（派人推荐 v2）：给静默观察者的派活候选打分——纯函数，不碰网络/DB，方便单测穷举边界。
//
// 用户已拍板的分叉（见 r13-workbench-refinement/01-new-batches-design.md 批 A2 §4）：不加轮转/
// 公平性惩罚因子——评分就按四项：资料完整度 + 历史交付量（对数尺度）+ 近期性衰减 + 技能标签重合度。
// 历史交付只算给 role='lead' 的工单归属人（调用方 packages/db/src/repositories/user-profiles.ts 的
// listCandidatesForProject 已经把聚合口径收在 SQL 里，这里只管拿到的数字怎么打分)。

export type ScoreCandidateInput = {
  // 是否已经填过任何资料（bioMd 非空，即"办过入职"意义上的最低资料完整度）。
  hasProfile: boolean;
  // 是否填了职位/角色头衔（title）——比"填过资料"更进一步的完整度信号，独立计分。
  hasTitle: boolean;
  // 该候选人历史上以 role='lead' 交付的 accepted_deliverable_changes 行数（去重计数）。
  acceptedDeliverableCount: number;
  // 距上一次交付过去多少天；null = 从未交付过（不给近期性加分，也不扣分——新人不因"没有历史"被惩罚，
  // 历史交付量那一项本身已经是 0，两项分开计，不重复惩罚同一件事）。
  daysSinceLastAccepted: number | null;
  // 候选人技能标签与任务文本的朴素重合度，取值范围 [0, 1]（0=完全不重合，1=候选人的技能标签
  // 全部在任务文本里出现过）——调用方可用 skillTagOverlapRatio 计算，也可以自己算后传入。
  skillTagOverlapWithTask: number;
};

// 四项各自的权重上限——设计成"资料完整度是小加分项，历史交付与技能重合是主力项，近期性是调味"，
// 而不是让某一项单独就能吃掉全部分数（穷举单测会钉死这个相对量级关系，见 assignee-scoring.test.ts）。
const HAS_PROFILE_WEIGHT = 10;
const HAS_TITLE_WEIGHT = 5;
const DELIVERY_LOG_WEIGHT = 20;
const RECENCY_WEIGHT = 15;
const RECENCY_HALF_LIFE_DAYS = 30;
const SKILL_OVERLAP_WEIGHT = 25;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

// 历史交付量按对数尺度计分——log2(1+N)：0 次=0 分，1 次≈1 分，5 次≈2.6 分，20 次≈4.4 分，
// 越往后新增一次交付带来的边际加分越小，防止极少数交付量特别大的人垄断所有候选名单的第一名。
function deliveryScore(acceptedDeliverableCount: number): number {
  const count = Number.isFinite(acceptedDeliverableCount) ? Math.max(0, acceptedDeliverableCount) : 0;
  return Math.log2(1 + count) * DELIVERY_LOG_WEIGHT;
}

// 近期性衰减：越近的交付分越高，按半衰期 30 天做指数衰减；从未交付过（null）不参与这一项计分
// （既不加分也不扣分——避免对"从没交付过"的候选人做双重惩罚，那件事已经体现在 deliveryScore=0 里）。
function recencyScore(daysSinceLastAccepted: number | null): number {
  if (daysSinceLastAccepted === null) {
    return 0;
  }
  const days = Number.isFinite(daysSinceLastAccepted) ? Math.max(0, daysSinceLastAccepted) : Number.POSITIVE_INFINITY;
  return RECENCY_WEIGHT * Math.pow(0.5, days / RECENCY_HALF_LIFE_DAYS);
}

export function scoreCandidate(input: ScoreCandidateInput): number {
  const profileScore = (input.hasProfile ? HAS_PROFILE_WEIGHT : 0) + (input.hasTitle ? HAS_TITLE_WEIGHT : 0);
  const overlapScore = clamp01(input.skillTagOverlapWithTask) * SKILL_OVERLAP_WEIGHT;
  return profileScore + deliveryScore(input.acceptedDeliverableCount) + recencyScore(input.daysSinceLastAccepted) + overlapScore;
}

// 候选人技能标签与任务文本的朴素重合度——按标签子串（大小写不敏感）在任务文本里是否出现来算比例，
// 不做分词/embedding（04 铁律不要求，设计稿原话是"朴素重合度"）。空标签列表视为 0 重合（不是满分）。
export function skillTagOverlapRatio(candidateSkillTags: readonly string[], taskText: string): number {
  const tags = candidateSkillTags.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
  if (tags.length === 0) {
    return 0;
  }
  const normalizedTask = taskText.toLowerCase();
  const matched = tags.filter((tag) => normalizedTask.includes(tag.toLowerCase()));
  return matched.length / tags.length;
}

// 从 listCandidatesForProject 的一行 + 当前判定用的任务/讨论文本，构造出 scoreCandidate 的输入。
// 调用方（conversation-observer.ts）负责把 lastAcceptedAt 换算成 daysSinceLastAccepted（依赖 now()，
// 不属于这个纯函数模块的职责）。
export type ScoredCandidate = {
  userId: string;
  nickname: string;
  title: string | null;
  score: number;
};

// 观察者 prompt 里只给 LLM 看 top N（5-8 个，04 铁律#4：不无上限塞候选名单进 prompt）。
export const CANDIDATE_ROSTER_PROMPT_MAX = 8;

export function rankCandidates(scored: ScoredCandidate[]): ScoredCandidate[] {
  return [...scored].sort((left, right) => right.score - left.score);
}
