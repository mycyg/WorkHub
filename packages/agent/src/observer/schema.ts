import { z } from "zod";

// R12 批3：静默观察者的结构化输出契约。观察者不是通用 agent loop（无工具、无多轮），只做一次
// 「读讨论 → 吐结构化计划」的判断，所以 schema 单独定义在这里，不复用 packages/contracts（events.ts
// 之外的 contracts 文件不在本批改动范围内——只加而不改批3不允许触碰的既有 contracts 文件）。

export const observerItemKindSchema = z.enum(["execute", "decide", "observe"]);
export type ObserverItemKind = z.infer<typeof observerItemKindSchema>;

export const observerConfidenceSchema = z.enum(["high", "mid", "low"]);
export type ObserverConfidence = z.infer<typeof observerConfidenceSchema>;

// nickname 与 users.nickname 同口径（varchar(64) not null）——这里只做粗校验，真正的成员匹配在
// 服务端按当前项目/工作区成员表做大小写不敏感匹配；匹配不上时按 03 §2C 落到项目负责人。
const suggestedAssigneeNicknameSchema = z.string().trim().min(1).max(64);

export const observerPlanItemSchema = z
  .object({
    kind: observerItemKindSchema,
    // title_md：行动卡条目标题，用户可见文案，去黑话（不出现 branch/PR/merge 等）。
    title_md: z.string().trim().min(1).max(500),
    confidence: observerConfidenceSchema,
    suggested_assignee_nickname: suggestedAssigneeNicknameSchema.optional()
  })
  .strict();
export type ObserverPlanItem = z.infer<typeof observerPlanItemSchema>;

// 一次分析最多拎 8 件事——防止单次静默窗口把整段讨论拆成一长串卡片，也给 prompt/落库设一个硬上限。
export const OBSERVER_PLAN_MAX_ITEMS = 8;

export const observerPlanSchema = z
  .object({
    items: z.array(observerPlanItemSchema).max(OBSERVER_PLAN_MAX_ITEMS),
    // 没活儿时模型必须显式说明理由（便于人工核查观察者是否在正常工作，而非默默吃掉了讨论）。
    reason_if_none: z.string().trim().max(500).optional()
  })
  .strict();
export type ObserverPlan = z.infer<typeof observerPlanSchema>;

export const EMPTY_OBSERVER_PLAN: ObserverPlan = { items: [] };
