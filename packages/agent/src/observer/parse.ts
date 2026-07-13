import {
  EMPTY_OBSERVER_PLAN,
  observerPlanItemSchema,
  observerPlanSchema,
  OBSERVER_PLAN_MAX_ITEMS,
  type ObserverPlan,
  type ObserverPlanItem
} from "./schema.js";

// 从 LLM 文本里抠出 JSON（容忍 ```json 围栏与前后噪声）。与 apps/api/src/services/skill-curation.ts 的
// parseFirstJsonObject 同一形态——本模块刻意不从 apps/api 导入（跨包边界 + 该文件不在本批改动范围内），
// 独立实现一份小函数，两处逻辑简单到不值得为了复用而抽一个新共享包。
function firstBalancedJsonObject(text: string): string | undefined {
  const start = text.indexOf("{");
  if (start < 0) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }
  return undefined;
}

function parseFirstJsonObject(text: string): unknown {
  if (!text) {
    return undefined;
  }
  const candidate = firstBalancedJsonObject(text);
  if (!candidate) {
    return undefined;
  }
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return undefined;
  }
}

// fail-closed：解析失败或整体 schema 不过时，逐项宽松收集合法条目（一项坏不连累全体），
// 与 skill-curation.parseDistilledResponse 同纪律。
export function parseObserverPlanResponse(text: string): ObserverPlan {
  const parsed = parseFirstJsonObject(text);
  if (!parsed) {
    return EMPTY_OBSERVER_PLAN;
  }
  const result = observerPlanSchema.safeParse(parsed);
  if (result.success) {
    return {
      items: result.data.items.slice(0, OBSERVER_PLAN_MAX_ITEMS),
      ...(result.data.reason_if_none ? { reason_if_none: result.data.reason_if_none } : {})
    };
  }
  const obj = parsed as { items?: unknown[]; reason_if_none?: unknown };
  const items: ObserverPlanItem[] = [];
  for (const item of Array.isArray(obj?.items) ? obj.items : []) {
    const single = observerPlanItemSchema.safeParse(item);
    if (single.success) {
      items.push(single.data);
    }
    if (items.length >= OBSERVER_PLAN_MAX_ITEMS) {
      break;
    }
  }
  return {
    items,
    ...(typeof obj?.reason_if_none === "string" ? { reason_if_none: obj.reason_if_none } : {})
  };
}

// 低质自检：空 items，或全部条目都是「仅观察」（不产生任何后续动作），一律不建卡——
// 群里不该为「没活儿」或「只是记一笔」的分析结果冒一张卡片出来。
export function isLowQualityObserverPlan(plan: ObserverPlan): boolean {
  if (plan.items.length === 0) {
    return true;
  }
  return plan.items.every((item) => item.kind === "observe");
}
