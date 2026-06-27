import { HTTPException } from "hono/http-exception";

type JsonRequestContext = {
  req: {
    json: () => Promise<unknown>;
  };
};

export const malformedJsonMessage = "Request body is not valid JSON.";
export const jsonObjectMessage = "Request body must be a JSON object.";

export async function readJsonObject(c: JsonRequestContext): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: malformedJsonMessage });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HTTPException(400, { message: jsonObjectMessage });
  }
  return value as Record<string, unknown>;
}
