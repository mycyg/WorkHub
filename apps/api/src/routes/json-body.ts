import { HTTPException } from "hono/http-exception";

type JsonRequestContext = {
  req: {
    text: () => Promise<string>;
  };
};

export const malformedJsonMessage = "Request body is not valid JSON.";
export const jsonObjectMessage = "Request body must be a JSON object.";

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
  return jsonObjectFromText(await c.req.text());
}
