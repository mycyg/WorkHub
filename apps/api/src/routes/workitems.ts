import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { Hono } from "hono";

import {
  createWorkItemRequestSchema,
  normalizeWorkHubLocale,
  type WorkHubLocale,
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
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type WorkItemRoutesDependencies = {
  auth?: AuthDependencySource;
  workItems?: WorkItemService;
};

function handleWorkItemError(error: unknown): never {
  throw error;
}

// 路由 uuid 形参先校验：非 uuid 串原本直达服务层的 uuid 列 → PG 22P02 → 误报 500；非法即抛与「合法但不存在」
// 同样的 404（WorkItemServiceError，经 app.onError 收口），不泄露存在性。
function requireWorkItemId(value: string): string {
  if (!isUuidParam(value)) {
    throw new WorkItemServiceError(404, "not_found", "没有找到这个事项。");
  }
  return value;
}

function requireAcceptedChangeId(value: string): string {
  if (!isUuidParam(value)) {
    throw new WorkItemServiceError(404, "deliverable_not_found", "没有找到这份正式交付物。");
  }
  return value;
}

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }): WorkHubLocale {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

function contentDisposition(filename: string) {
  const ascii = filename.replace(/["\\\r\n]/gu, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function isTextPreview(filename: string, mime?: string) {
  const lower = filename.toLowerCase();
  return !!mime?.startsWith("text/")
    || mime === "application/json"
    || mime === "application/xml"
    || mime === "application/yaml"
    || mime === "application/x-yaml"
    || lower.endsWith(".md")
    || lower.endsWith(".json")
    || lower.endsWith(".csv")
    || lower.endsWith(".txt")
    || lower.endsWith(".tsv")
    || lower.endsWith(".html")
    || lower.endsWith(".xml")
    || lower.endsWith(".yaml")
    || lower.endsWith(".yml");
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
      throw new WorkItemServiceError(
        404,
        "deliverable_file_missing",
        "正式交付物文件已不存在，请重新生成或查看历史记录。"
      );
    }
    throw error;
  }
}

type WorkItemRouteDeliverableFile = Awaited<ReturnType<WorkItemService["acceptedDeliverableFile"]>>;

function sha256Buffer(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parsedTextFallback(
  file: WorkItemRouteDeliverableFile,
  encoding?: BufferEncoding,
  options: { requireComplete?: boolean } = {}
) {
  if (file.parsedText === undefined) {
    throw new WorkItemServiceError(
      404,
      "deliverable_file_missing",
      "正式交付物文件已不存在，请重新生成或查看历史记录。"
    );
  }
  const bytes = Buffer.from(file.parsedText, "utf8");
  if (options.requireComplete) {
    if (bytes.byteLength !== file.sizeBytes) {
      throw new WorkItemServiceError(
        404,
        "deliverable_file_missing",
        "正式交付物文件已不存在，请重新生成或查看历史记录。"
      );
    }
    if (file.sha256 && sha256Buffer(bytes) !== file.sha256) {
      throw new WorkItemServiceError(
        404,
        "deliverable_file_missing",
        "正式交付物文件已不存在，请重新生成或查看历史记录。"
      );
    }
  }
  return encoding ? file.parsedText : bytes;
}

function readDeliverableContent(file: WorkItemRouteDeliverableFile): Promise<Buffer>;
function readDeliverableContent(file: WorkItemRouteDeliverableFile, encoding: undefined, options: { requireCompleteParsedText?: boolean }): Promise<Buffer>;
function readDeliverableContent(file: WorkItemRouteDeliverableFile, encoding: BufferEncoding): Promise<string>;
function readDeliverableContent(file: WorkItemRouteDeliverableFile, encoding: BufferEncoding, options: { requireCompleteParsedText?: boolean }): Promise<string>;
async function readDeliverableContent(
  file: WorkItemRouteDeliverableFile,
  encoding?: BufferEncoding,
  options: { requireCompleteParsedText?: boolean } = {}
) {
  try {
    return encoding ? await readStoredDeliverable(file.storagePath, encoding) : await readStoredDeliverable(file.storagePath);
  } catch (error) {
    if (error instanceof WorkItemServiceError && error.code === "deliverable_file_missing") {
      return parsedTextFallback(
        file,
        encoding,
        options.requireCompleteParsedText ? { requireComplete: true } : {}
      );
    }
    throw error;
  }
}

export function createWorkItemRoutes(deps: WorkItemRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const workItems = deps.workItems ?? getDefaultWorkItemService();

  routes.post("/workitems", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    const rawPayload = await readJsonObject(c);
    const rawSessionId = rawPayload.session_id;
    try {
      if (typeof rawSessionId === "string" && rawSessionId.trim() && isUuidParam(rawSessionId)) {
        await workItems.assertCanMutateWorkItem({ workItemId: rawSessionId, actor: c.var.actor });
      }
      const payload = createWorkItemRequestSchema.parse(rawPayload);
      const data = await workItems.createWorkItem({ payload, actor: c.var.actor, locale });
      return c.json({ ok: true, data, meta: { locale } }, 201);
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.post("/workitems/:id/evidence-bindings", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const workItemId = requireWorkItemId(c.req.param("id"));
      await workItems.assertCanMutateWorkItem({ workItemId, actor: c.var.actor });
      const payload = useEvidenceForTaskRequestSchema.parse(await readJsonObject(c));
      const data = await workItems.bindEvidence({
        workItemId,
        payload,
        actor: c.var.actor,
        locale
      });
      return c.json({ ok: true, data, meta: { locale } });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.get("/workitems/:id/deliverables/:acceptedChangeId/download", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const file = await workItems.acceptedDeliverableFile({
        workItemId: requireWorkItemId(c.req.param("id")),
        acceptedChangeId: requireAcceptedChangeId(c.req.param("acceptedChangeId")),
        actor: c.var.actor
      });
      const content = await readDeliverableContent(file, undefined, { requireCompleteParsedText: true });
      return c.body(content, 200, {
        "Content-Type": file.mime ?? "application/octet-stream",
        // findings[#low]：Content-Length 取实际发出的字节数，而不是可能过期/截断的 DB sizeBytes。
        "Content-Length": String(content.byteLength),
        "Content-Disposition": contentDisposition(file.filename)
      });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  routes.get("/workitems/:id/deliverables/:acceptedChangeId/preview", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const file = await workItems.acceptedDeliverableFile({
        workItemId: requireWorkItemId(c.req.param("id")),
        acceptedChangeId: requireAcceptedChangeId(c.req.param("acceptedChangeId")),
        actor: c.var.actor
      });
      if (!isTextPreview(file.filename, file.mime)) {
        throw new WorkItemServiceError(
          415,
          "deliverable_preview_unsupported",
          "这类正式交付物暂不支持在线预览，请下载查看。"
        );
      }
      const text = await readDeliverableContent(file, "utf8", { requireCompleteParsedText: true });
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

  routes.post("/workitems/:id/deliverables/:acceptedChangeId/restore", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const data = await workItems.restoreAcceptedDeliverable({
        workItemId: requireWorkItemId(c.req.param("id")),
        acceptedChangeId: requireAcceptedChangeId(c.req.param("acceptedChangeId")),
        actor: c.var.actor
      });
      return c.json({ ok: true, data });
    } catch (error) {
      handleWorkItemError(error);
    }
  });

  return routes;
}
