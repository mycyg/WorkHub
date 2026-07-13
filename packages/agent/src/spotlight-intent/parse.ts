import { spotlightIntentResultSchema, type SpotlightIntentResult } from "./schema.js";

// 从 LLM 文本里抠出 JSON（容忍前后噪声，不容忍 ```json 围栏之外的做法）。与
// packages/agent/src/observer/parse.ts 的 firstBalancedJsonObject 同一形态——本模块刻意不从
// observer/parse.ts 导入（那份函数未导出，且两处逻辑简单到不值得为了复用抽一个共享工具，同款取舍
// 已经写在 observer/parse.ts 顶部注释里）。
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

// fail-closed：解析失败、schema 不过、或（open_page 时）page 不在调用方提供的可用能力清单里，
// 一律返回 undefined——调用方（apps/api 的 service）据此映射成一个温和的 500，绝不把一个编造出来的
// 页面 id 或畸形结构透传给客户端。allowedPageIds 是本次请求「可用能力清单」的 id 集合：这是一个纯
// 业务校验，不涉及网络/DB，所以放在这个纯函数里而不是留给调用方各自重复判断。
export function parseSpotlightIntentResponse(
  text: string,
  allowedPageIds: readonly string[]
): SpotlightIntentResult | undefined {
  const parsed = parseFirstJsonObject(text);
  if (!parsed) {
    return undefined;
  }
  const result = spotlightIntentResultSchema.safeParse(parsed);
  if (!result.success) {
    return undefined;
  }
  if (result.data.intent === "open_page" && !allowedPageIds.includes(result.data.page)) {
    return undefined;
  }
  return result.data;
}
