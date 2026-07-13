import { z, toJSONSchema } from "zod";

import { idSchema } from "@workhub/contracts";

// R13 批4c（Cuu 对话工具面）：受限工具环的工具定义——纯函数/纯 schema，不碰网络/DB（真正的执行逻辑在
// apps/api/src/services/conversation-turns.ts，那里有 DB/权限依赖，不适合放进这个无副作用的包）。
// 同构 packages/tools/src/registry.ts 用 zod 的 toJSONSchema() 生成 Anthropic 风格 input_schema 的
// 做法，但不复用那个 registry——那套是为完整 AgentLoop（文件沙箱工具、snapshot 门禁）设计的重量级
// 机制，turn 这里只有 3~4 个 DB 背书的轻量工具，没有 workdir/snapshot 概念，硬套只会引入不匹配的复杂度。
//
// 三个工具对应设计稿（r13-workbench-refinement/01-new-batches-design.md 一、批4c）：
// - drive_search：只读检索，不落库。
// - send_file_card：确认文件存在且可见后，发一条真实 file_card 消息。
// - create_work_item：需求已经清楚（且经过澄清往返）时才可调用，建一个真实工单。
// 第四个 ask_clarifying_question 是本批对设计稿"发一条 kind='clarifying_question' 消息"这段描述的
// 一处具体化：设计稿建议靠模型自由文本发一条新 kind 的消息，但 04 铁律范围围栏本批不许碰 schema/迁移，
// 无法新增 DB kind；改为把"这是一条澄清追问"做成一次显式、可校验的工具调用（而不是靠模型的自由文本
// 语气去猜），服务端据此把回复落成既有 kind='text'、附加 is_clarifying_question 标记（additive 字段，
// 见 @workhub/contracts 的 conversationTextContentSchema）。这样"要不要发起澄清"仍然是模型的判断，
// 只是"发起澄清"这个动作本身从"祈祷模型格式正确的自由文本"变成了结构化、可 zod 校验的工具调用，更可靠。

export const DRIVE_SEARCH_TOOL = "drive_search";
export const SEND_FILE_CARD_TOOL = "send_file_card";
export const CREATE_WORK_ITEM_TOOL = "create_work_item";
export const ASK_CLARIFYING_QUESTION_TOOL = "ask_clarifying_question";

// 设计稿「一次 createTurn 调用内最多执行 3 次工具调用（硬顶，防失控）」；委托任务书的「≤4 轮」是
// 模型调用轮数上限——3 次工具调用 + 最后强制不带工具的收尾轮，正好是 4 轮，两个数字互相印证，不是
// 两个独立配置项。见 conversation-turns.ts 的循环实现如何用这两个常量保证有限终止。
export const MAX_TURN_TOOL_CALLS = 3;
export const MAX_TURN_MODEL_ROUNDS = MAX_TURN_TOOL_CALLS + 1;

export const driveSearchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200)
  })
  .strict();
export type DriveSearchToolInput = z.infer<typeof driveSearchInputSchema>;

export const sendFileCardInputSchema = z
  .object({
    drive_item_id: idSchema
  })
  .strict();
export type SendFileCardToolInput = z.infer<typeof sendFileCardInputSchema>;

export const createWorkItemToolInputSchema = z
  .object({
    title: z.string().trim().min(1).max(256),
    summary: z.string().trim().min(1).max(4000),
    clarification_answer: z.string().trim().min(1).max(4000).optional()
  })
  .strict();
export type CreateWorkItemToolInput = z.infer<typeof createWorkItemToolInputSchema>;

export const askClarifyingQuestionInputSchema = z
  .object({
    question: z.string().trim().min(1).max(500),
    options: z.array(z.string().trim().min(1).max(200)).max(8).optional(),
    placeholder: z.string().trim().min(1).max(200).optional()
  })
  .strict();
export type AskClarifyingQuestionToolInput = z.infer<typeof askClarifyingQuestionInputSchema>;

function jsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  try {
    const result = toJSONSchema(schema) as Record<string, unknown>;
    delete result["$schema"];
    return result;
  } catch {
    return { type: "object" };
  }
}

export type TurnToolDefinitionOptions = {
  // create_work_item 只在存在「待回答的澄清追问」时才对模型可见——见 conversation-turns.ts 的
  // findPendingClarification。不满足时把这个工具整个从清单里拿掉，而不是留着让模型调用后再拒绝：
  // 少一次必然失败的往返，也让「没澄清清楚就不该建工单」这条红线在工具可见性这一层就生效（04 铁律#3
  // 精神的延伸：宁可不摆出这个按钮，也不摆一个点了没用的）。
  allowCreateWorkItem: boolean;
};

export function buildTurnToolDefinitions(options: TurnToolDefinitionOptions): unknown[] {
  const tools: unknown[] = [
    {
      name: DRIVE_SEARCH_TOOL,
      description: "只读检索这个项目网盘里的文件（按文件名模糊匹配，最多返回 5 条）。不会修改任何内容，也不会把结果发给对方——检索完之后，如果确实找到了对方要的文件，再调用 send_file_card 发出去。",
      input_schema: jsonSchema(driveSearchInputSchema)
    },
    {
      name: SEND_FILE_CARD_TOOL,
      description: "把 drive_search 检索到的某一个具体文件，以文件卡片的形式发给对方。只能发之前检索到的、确认存在且有权限查看的文件；找不到或不确定就诚实说找不到，不要编造文件或编造 drive_item_id。",
      input_schema: jsonSchema(sendFileCardInputSchema)
    },
    {
      name: ASK_CLARIFYING_QUESTION_TOOL,
      description: "当对方想让你新建一个工单/任务，但需求还含糊（缺关键信息，无法直接建出一个可执行的工单）时，用这个工具提出一个具体的澄清问题；调用后这一轮直接结束，等对方回答，不要在同一轮里又调用别的工具。",
      input_schema: jsonSchema(askClarifyingQuestionInputSchema)
    }
  ];
  if (options.allowCreateWorkItem) {
    tools.push({
      name: CREATE_WORK_ITEM_TOOL,
      description: "需求已经清楚（对方一开始就说得很明确，或者你已经问过澄清问题并得到了回答）时，新建一个真实工单。不要在需求还含糊的时候调用——那种情况请改用 ask_clarifying_question。",
      input_schema: jsonSchema(createWorkItemToolInputSchema)
    });
  }
  return tools;
}

export type ParsedTurnToolCall =
  | { ok: true; name: typeof DRIVE_SEARCH_TOOL; input: DriveSearchToolInput }
  | { ok: true; name: typeof SEND_FILE_CARD_TOOL; input: SendFileCardToolInput }
  | { ok: true; name: typeof CREATE_WORK_ITEM_TOOL; input: CreateWorkItemToolInput }
  | { ok: true; name: typeof ASK_CLARIFYING_QUESTION_TOOL; input: AskClarifyingQuestionToolInput }
  | { ok: false; name: string; error: string };

// 每个 tool_use 块都过一次这里——不管模型给的 input 是正常对象、是空对象、还是因为 max_tokens 截断而
// 退化成一段半截字符串（anthropic-compatible.ts 的 finalizeBlock 在 JSON.parse 失败时会把 input 原样
// 存成字符串），zod 的 safeParse 对「输入类型都不对」的情况天然返回 ok:false，不会抛异常。这就是本批
// 「半截 tool_use 不应导致下一次调用 400」的核心机制：调用方（conversation-turns.ts）无论 ok 是
// true 还是 false，都会给这个 tool_use 生成恰好一条 tool_result（成功执行的结果，或者一条错误说明），
// 绝不会让一个 tool_use 没有配对的 tool_result——不需要像 loop.ts 的 dropDanglingToolUse 那样事后
// 从消息历史里"摘除"，因为这里从一开始就不会产生悬空。
export function parseTurnToolCall(name: string, rawInput: unknown): ParsedTurnToolCall {
  switch (name) {
    case DRIVE_SEARCH_TOOL: {
      const parsed = driveSearchInputSchema.safeParse(rawInput);
      return parsed.success
        ? { ok: true, name: DRIVE_SEARCH_TOOL, input: parsed.data }
        : { ok: false, name, error: "drive_search 的参数不对，需要一个非空的 query 字符串。" };
    }
    case SEND_FILE_CARD_TOOL: {
      const parsed = sendFileCardInputSchema.safeParse(rawInput);
      return parsed.success
        ? { ok: true, name: SEND_FILE_CARD_TOOL, input: parsed.data }
        : { ok: false, name, error: "send_file_card 的参数不对，需要一个有效的 drive_item_id。" };
    }
    case CREATE_WORK_ITEM_TOOL: {
      const parsed = createWorkItemToolInputSchema.safeParse(rawInput);
      return parsed.success
        ? { ok: true, name: CREATE_WORK_ITEM_TOOL, input: parsed.data }
        : { ok: false, name, error: "create_work_item 的参数不对，需要非空的 title 和 summary。" };
    }
    case ASK_CLARIFYING_QUESTION_TOOL: {
      const parsed = askClarifyingQuestionInputSchema.safeParse(rawInput);
      return parsed.success
        ? { ok: true, name: ASK_CLARIFYING_QUESTION_TOOL, input: parsed.data }
        : { ok: false, name, error: "ask_clarifying_question 的参数不对，需要一个非空的 question。" };
    }
    default:
      return { ok: false, name, error: `未知工具：${name}` };
  }
}
