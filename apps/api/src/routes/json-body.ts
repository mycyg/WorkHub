import { HTTPException } from "hono/http-exception";

type JsonRequestContext = {
  req: {
    raw: Request;
  };
};

export const malformedJsonMessage = "Request body is not valid JSON.";
export const jsonObjectMessage = "Request body must be a JSON object.";
export const jsonBodyTooLargeMessage = "Request body exceeds the JSON size limit.";

// API-03：与 app.ts 声明长度预检同一口径（1 MiB，MAX_REQUEST_BODY_BYTES 可调）。
const DEFAULT_MAX_JSON_BODY_BYTES = 1_048_576; // 1 MiB
export function resolveMaxJsonBodyBytes(): number {
  const raw = process.env.MAX_REQUEST_BODY_BYTES;
  if (!raw) {
    return DEFAULT_MAX_JSON_BODY_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_JSON_BODY_BYTES;
}

// API-03：app.ts 的上限只查 Content-Length 声明，chunked/缺声明可绕过让 JSON 体无上限入内存。
// 这里流式读入、边读边计数，超限即在硬上限处截断回 413（与 drive 的 readBoundedUploadBytes 同做法）。
async function readBoundedBodyText(request: Request, capBytes: number): Promise<string> {
  const stream = request.body;
  if (!stream) {
    return "";
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > capBytes) {
        await reader.cancel();
        throw new HTTPException(413, { message: jsonBodyTooLargeMessage });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export function jsonObjectFromText(text: string): Record<string, unknown> {
  let value: unknown;
  if (!text.trim()) {
    return {};
  }
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: malformedJsonMessage });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HTTPException(400, { message: jsonObjectMessage });
  }
  return value as Record<string, unknown>;
}

export async function readJsonObject(c: JsonRequestContext): Promise<Record<string, unknown>> {
  return jsonObjectFromText(await readBoundedBodyText(c.req.raw, resolveMaxJsonBodyBytes()));
}
