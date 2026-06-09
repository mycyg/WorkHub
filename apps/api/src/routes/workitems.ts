import { readFile } from "node:fs/promises";

import { Hono, type Context } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  createWorkItemRequestSchema,
  useEvidenceForTaskRequestSchema
} from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  getDefaultWorkItemService,
  WorkItemServiceError,
  type WorkItemService
} from "../services/work-items.js";

export type WorkItemRoutesDependencies = {
  auth?: AuthDependencySource;
  workItems?: WorkItemService;
};

function handleWorkItemError(error: unknown): never {
  if (error instanceof WorkItemServiceError) {
    throw new HTTPException(error.status as 400, { message: error.message });
  }
  throw error;
}

function contentDisposition(filename: string) {
  const ascii = filename.replace(/["\\\r\n]/gu, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function isTextPreview(filename: string, mime?: string) {
  const lower = filename.toLowerCase();
  return !!mime?.startsWith("text/")
    || mime === "application/json"
    || lower.endsWith(".md")
    || lower.endsWith(".json")
    || lower.endsWith(".csv")
    || lower.endsWith(".txt");
}

function readStoredDeliverable(storagePath: string): Promise<Buffer>;
function readStoredDeliverable(storagePath: string, encoding: BufferEncoding): Promise<string>;
async function readStoredDeliverable(storagePath: string, encoding?: BufferEncoding) {
  try {
    return encoding ? await readFile(storagePath, encoding) : await readFile(storagePath);
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "ENOENT"
    ) {
      throw new HTTPException(404, { message: "正式交付物文件已不存在，请重新生成或查看历史记录。" });
    }
    throw error;
  }
}

async function readJsonBody(c: Context) {
  const text = await c.req.text();
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HTTPException(400, { message: "工作项请求不是有效的 JSON。" });
  }
}

export function createWorkItemRoutes(deps: WorkItemRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const workItems = deps.workItems ?? getDefaultWorkItemService();

  routes.post("/workitems", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = createWorkItemRequestSchema.parse(await readJsonBody(c));
    try {
      const data = await workItems.createWorkItem({ payload, actor: c.var.actor });
      return c.json({ ok: true, data }, 201);
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.post("/workitems/:id/evidence-bindings", createCurrentUserMiddleware(authSource), async (c) => {
    const payload = useEvidenceForTaskRequestSchema.parse(await readJsonBody(c));
    try {
      const data = await workItems.bindEvidence({
        workItemId: c.req.param("id"),
        payload,
        actor: c.var.actor
      });
      return c.json({ ok: true, data });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.get("/workitems/:id/deliverables/:acceptedChangeId/download", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const file = await workItems.acceptedDeliverableFile({
        workItemId: c.req.param("id"),
        acceptedChangeId: c.req.param("acceptedChangeId"),
        actor: c.var.actor
      });
      const content = await readStoredDeliverable(file.storagePath);
      return c.body(content, 200, {
        "Content-Type": file.mime ?? "application/octet-stream",
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": contentDisposition(file.filename)
      });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.get("/workitems/:id/deliverables/:acceptedChangeId/preview", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const file = await workItems.acceptedDeliverableFile({
        workItemId: c.req.param("id"),
        acceptedChangeId: c.req.param("acceptedChangeId"),
        actor: c.var.actor
      });
      if (!isTextPreview(file.filename, file.mime)) {
        throw new HTTPException(415, { message: "这类正式交付物暂不支持在线预览，请下载查看。" });
      }
      const text = await readStoredDeliverable(file.storagePath, "utf8");
      const maxPreviewChars = 200000;
      return c.json({
        ok: true,
        data: {
          id: file.id,
          filename: file.filename,
          ...(file.mime ? { mime: file.mime } : {}),
          size_bytes: file.sizeBytes,
          preview_type: "text",
          text: text.slice(0, maxPreviewChars),
          truncated: text.length > maxPreviewChars,
          download_href: `/api/workitems/${c.req.param("id")}/deliverables/${c.req.param("acceptedChangeId")}/download`
        }
      });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  return routes;
}
