import { z } from "zod";

// R13 批 S1（聚焦盒 AI 入口）：桌面 Spotlight 盒子在命令面板无命中时，把用户的自然语言原话交给一次
// 轻量 LLM 分类调用——不是通用 agent loop（无工具、无多轮、不建会话），只做一次「这句话该干什么」的
// 判断，与 packages/agent/src/observer/schema.ts 同一形态：schema 单独定义在这里，不复用
// packages/contracts（events.ts 之外的 contracts 文件不在本批改动范围内）。

// 四类动作，照 r13-workbench-refinement/00-plan.md 批 S1：
// - open_page：跳转到聚焦盒的某个已知能力（page 必须是调用方随请求提供的「可用能力清单」里的一个 id，
//   服务端会校验，见 parse.ts）。
// - new_project：新建项目（携带分类出的项目名，供客户端预填新建项目入口）。
// - create_task：新建任务（携带分类出的任务标题，客户端据此走既有工作项创建路径）。
// - answer：纯问答，不产生任何动作——盒内直接展示这段回答，不落库、不建会话。
export const spotlightIntentKindSchema = z.enum(["open_page", "new_project", "create_task", "answer"]);
export type SpotlightIntentKind = z.infer<typeof spotlightIntentKindSchema>;

// 只分高/低两档——聚焦盒的确认条只需要「直接做」还是「先问一下」这一个二元判断，三档以上的置信度
// 对这个场景是过度设计（观察者的 high/mid/low 三档是因为要区分「要不要升级给人拍板」，这里没有那层语义）。
export const spotlightIntentConfidenceSchema = z.enum(["high", "low"]);
export type SpotlightIntentConfidence = z.infer<typeof spotlightIntentConfidenceSchema>;

// 调用方（apps/api 的路由层）随请求提供的「可用能力清单」——即桌面端 command-palette.ts 的
// commandRegistry 摊平成 {id,label,hint}。刻意不在这里硬编码 CommandId 枚举：packages/agent 不应该
// 依赖 apps/desktop-webview（包依赖方向），且能力清单本就该由调用方决定"当前有哪些能力可选"，
// 服务端只按调用方传入的 id 集合校验分类结果（见 parseSpotlightIntentResponse 的 allowedPageIds 参数）。
export const spotlightIntentCapabilitySchema = z
  .object({
    id: z.string().trim().min(1).max(64),
    label: z.string().trim().min(1).max(120),
    hint: z.string().trim().max(200).optional()
  })
  .strict();
export type SpotlightIntentCapability = z.infer<typeof spotlightIntentCapabilitySchema>;

// 分类结果——判别联合体：不同 intent 只携带各自需要的参数字段，answer_md 只在 intent=answer 时出现，
// 与设计要求「输出=zod 严格 {intent,confidence,参数,answer_md(仅 answer)}」精确对齐。
const openPageResultSchema = z
  .object({
    intent: z.literal("open_page"),
    confidence: spotlightIntentConfidenceSchema,
    page: z.string().trim().min(1).max(64)
  })
  .strict();

const newProjectResultSchema = z
  .object({
    intent: z.literal("new_project"),
    confidence: spotlightIntentConfidenceSchema,
    project_name: z.string().trim().min(1).max(200)
  })
  .strict();

const createTaskResultSchema = z
  .object({
    intent: z.literal("create_task"),
    confidence: spotlightIntentConfidenceSchema,
    task_title: z.string().trim().min(1).max(300)
  })
  .strict();

const answerResultSchema = z
  .object({
    intent: z.literal("answer"),
    confidence: spotlightIntentConfidenceSchema,
    // markdown-lite：客户端只做纯文本+换行渲染，不引入 markdown 库——这里的长度上限对应「盒内内联」
    // 的展示场景，不是长文档。
    answer_md: z.string().trim().min(1).max(4000)
  })
  .strict();

export const spotlightIntentResultSchema = z.discriminatedUnion("intent", [
  openPageResultSchema,
  newProjectResultSchema,
  createTaskResultSchema,
  answerResultSchema
]);
export type SpotlightIntentResult = z.infer<typeof spotlightIntentResultSchema>;
