import { DEFAULT_USER_AI_PROFILE, cuuProactivitySchema, type CuuProactivity } from "@workhub/contracts";

// R23 P3b（SA-07）：把设置页的「助手主动性」三档（安静 / 均衡 / 主动）翻译成各主动性任务真正读得懂的
// 闸门参数。此前 user_ai_profiles.cuu_proactivity 只写不读——桌面设置页能切、能落库，但 care-scan /
// ddl-chase / conversation-observer 一个都不看它，用户调成「安静」后打扰频率分毫不变（勾了却照发）。
//
// 单一真相点纪律：三档 → 具体行为的映射只此一处。各调用方只读这里的字段，不各自 if 档位——否则第四个
// 消费点上线时又要在三个文件里各写一遍 switch，很快就会互相矛盾。
//
// 「均衡」= 逐字保持接线前的既有行为，这是本次改造的不变式：默认档（DEFAULT_USER_AI_PROFILE.
// cuu_proactivity）就是 balanced，所以从没改过设置的用户感受不到任何变化。

// ddl-chase 的四段阶梯 + 无责任人的「找人」。类型定义放在这里而不是 ddl-chase.ts，避免策略层反向
// 依赖任务层（ddl-chase.ts 的 DdlStage 直接引用本类型，仍是同一个联合）。
export type ProactivityDdlStage = "t3d" | "t1d" | "overdue" | "escalate" | "needs_owner";

export type ProactivityPolicy = {
  level: CuuProactivity;
  // 关怀会话是否投递。安静档整条关闭——关怀是三条主动性里最"打扰"的一条（Cuu 在个人空间不请自来
  // 说闲话），说了不想被打扰的人首先不该收到它。
  allowCare: boolean;
  // 允许发出的 DDL 阶梯。安静档只留「已逾期」及其之后的问责链路（overdue / escalate / needs_owner）——
  // 前两段（还有 3 天 / 还有 1 天）纯属提前提醒，可以省。
  // 刻意保留 escalate / needs_owner：这两段的目标是【项目负责人】而非迟到的人，属于问责与兜底通道，
  // 静音它们等于让逾期工作项彻底消失在所有人视野里，那不是"少打扰"而是"丢事"。
  allowedDdlStages: ReadonlySet<ProactivityDdlStage>;
  // 允许改走 Cuu 会话通道（个人空间里直接说话）的阶梯；其余阶梯走系统通知。
  // 安静档为空集 = 一律走通知，Cuu 不在个人空间开口。
  ddlConversationStages: ReadonlySet<ProactivityDdlStage>;
  // 主区观察者的静默窗口倍数：讨论停下多久之后 Cuu 才开口拎事。>1 = 更能沉住气（安静档），
  // <1 = 更快接话（主动档）。
  observerSilenceMultiplier: number;
};

const ALL_DDL_STAGES: ReadonlySet<ProactivityDdlStage> = new Set<ProactivityDdlStage>([
  "t3d",
  "t1d",
  "overdue",
  "escalate",
  "needs_owner"
]);

const POLICIES: Record<CuuProactivity, ProactivityPolicy> = {
  quiet: {
    level: "quiet",
    allowCare: false,
    allowedDdlStages: new Set<ProactivityDdlStage>(["overdue", "escalate", "needs_owner"]),
    ddlConversationStages: new Set<ProactivityDdlStage>(),
    observerSilenceMultiplier: 2
  },
  balanced: {
    level: "balanced",
    allowCare: true,
    allowedDdlStages: ALL_DDL_STAGES,
    // 接线前的既有行为：t1d/overdue 两档走会话（且仍受 PROACTIVE_CUU_DELIVERY_ENABLED 总开关约束）。
    ddlConversationStages: new Set<ProactivityDdlStage>(["t1d", "overdue"]),
    observerSilenceMultiplier: 1
  },
  proactive: {
    level: "proactive",
    allowCare: true,
    allowedDdlStages: ALL_DDL_STAGES,
    // 主动档多放开 t3d：还有三天到期时 Cuu 就直接来说一声，而不是只发条通知。
    ddlConversationStages: new Set<ProactivityDdlStage>(["t3d", "t1d", "overdue"]),
    observerSilenceMultiplier: 0.5
  }
};

// 读侧防御：cuu_proactivity 落库时有 check 约束，但历史脏数据/手改库不该让整个 tick 崩掉——
// 认不出的值一律回落默认档（balanced = 既有行为）。
export function resolveProactivityPolicy(level: string | null | undefined): ProactivityPolicy {
  const parsed = cuuProactivitySchema.safeParse(level);
  return POLICIES[parsed.success ? parsed.data : DEFAULT_USER_AI_PROFILE.cuu_proactivity];
}

export type ProactivityProfileKey = { workspaceId: string; userId: string };

export type ProactivityProfileReader = {
  // 同一 tick 内同一用户只查一次库（扫描任务一轮可能反复撞到同一个人）。
  get: (key: ProactivityProfileKey) => Promise<ProactivityPolicy>;
};

// 档案是 (workspace_id, user_id) 唯一——同一个人在不同工作区可以有不同档位，缓存键必须带工作区。
export type ProactivityProfileLoader = (key: ProactivityProfileKey) => Promise<string | null | undefined>;

/**
 * 建一个 tick 级的档位缓存。调用方在每次 runOnce 开头新建一个，tick 结束即丢弃——
 * 不做跨 tick 缓存：用户在设置页改完档位，下一个 tick 就该生效，不该等某个缓存过期。
 */
export function createProactivityProfileReader(load: ProactivityProfileLoader): ProactivityProfileReader {
  const cache = new Map<string, ProactivityPolicy>();
  return {
    async get(key: ProactivityProfileKey): Promise<ProactivityPolicy> {
      const cacheKey = `${key.workspaceId}:${key.userId}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached;
      }
      let policy: ProactivityPolicy;
      try {
        policy = resolveProactivityPolicy(await load(key));
      } catch {
        // 读档案失败 fail-open 到默认档（既有行为）——查询坏了不该把主动性整条掐死。
        policy = resolveProactivityPolicy(undefined);
      }
      cache.set(cacheKey, policy);
      return policy;
    }
  };
}

// 生产接线用的 loader 工厂：从 ai-settings 仓库读一条用户档案的档位。找不到档案（从没保存过设置）
// 返回 undefined → 默认档。
export function createAiSettingsProactivityLoader(
  findUserProfileAccessRecord: (
    input: ProactivityProfileKey
  ) => Promise<{ profile?: { cuuProactivity?: string | null } | null } | null>
): ProactivityProfileLoader {
  return async (key) => (await findUserProfileAccessRecord(key))?.profile?.cuuProactivity ?? undefined;
}
