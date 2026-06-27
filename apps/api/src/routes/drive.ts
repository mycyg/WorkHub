import { Hono, type Context } from "hono";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { normalizeWorkHubLocale, type DrivePageVM, type WorkItemDetailVM } from "@workhub/contracts";
import { settings as defaultSettings, type Settings } from "@workhub/config";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import {
  DrivePageServiceError,
  getDefaultDrivePageService,
  type DrivePageService
} from "../services/drive-pages.js";
import { readJsonObject } from "./json-body.js";
import { isUuidParam } from "./uuid-param.js";

export type DriveRoutesDependencies = {
  auth?: AuthDependencySource;
  drivePages?: DrivePageService;
  settings?: Pick<Settings, "dataDir">;
};

const uploadDriveFileSchema = z.object({
  filename: z.string().trim().min(1).max(256),
  mime: z.string().trim().min(1).max(128).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  sha256: z.string().length(64).optional(),
  parsed_text: z.string().max(200_000).optional()
});

type ParsedDriveUpload = {
  filename: string;
  mime?: string;
  sizeBytes?: number;
  storagePath?: string;
  sha256?: string;
  parsedText?: string;
};

const parsedTextLimit = 200_000;
const textLikeDriveFile = /\.(csv|json|md|markdown|txt|tsv|html|xml|yaml|yml)$/iu;

const driveDeleteSchema = z.object({
  expected_current_version_id: z.uuid().nullable().optional()
});

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }) {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

function pageEnvelope<T extends DrivePageVM | WorkItemDetailVM>(data: T, locale: ReturnType<typeof requestLocale>) {
  return {
    ok: true,
    data,
    meta: { locale }
  } as const;
}

function driveErrorResponse(c: Context<AuthEnv>, error: DrivePageServiceError) {
  return c.json({
    ok: false,
    error: {
      code: error.code,
      message: error.message
    }
  }, error.status);
}

// findings[#19]：路由 uuid 形参在到达 DB 查询前先校验。非 uuid 串(如 /projects/not-a-uuid/...)原本直达
// `eq(projects.id, value)`，PG 以 22P02 invalid uuid 抛未捕获 500。这里非法即抛 DrivePageServiceError(404)，
// 经既有 catch 走 driveErrorResponse——与「合法但不存在的 uuid 同样 404」一致，攻击者无法据此区分存在性。
function requireUuidParam(value: string, label: string): string {
  if (!isUuidParam(value)) {
    throw new DrivePageServiceError(404, `没有找到这个${label}。`, "not_found");
  }
  return value;
}

function headerIncludes(value: string | undefined, token: string) {
  return value?.toLowerCase().includes(token) ?? false;
}

function formString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isBlobLike(value: unknown): value is Blob & { name?: string } {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function" &&
      typeof (value as { size?: unknown }).size === "number"
  );
}

function displayFilename(value: string) {
  const normalized = value.replace(/\\/gu, "/");
  const base = path.basename(normalized).trim();
  return base || "upload.bin";
}

function contentDisposition(filename: string) {
  const ascii = filename.replace(/["\\\r\n]/gu, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function storageFilename(value: string) {
  return displayFilename(value).replace(/[/:\\\0]/gu, "_");
}

function isTextPreview(filename: string, mime?: string) {
  const normalizedMime = mime?.toLowerCase() ?? "";
  const lower = filename.toLowerCase();
  return normalizedMime.startsWith("text/")
    || normalizedMime === "application/json"
    || normalizedMime === "application/xml"
    || normalizedMime === "application/yaml"
    || /\.(csv|json|md|markdown|txt|tsv|html|xml|yaml|yml)$/u.test(lower);
}

function readStoredDriveFile(storagePath: string): Promise<Buffer>;
function readStoredDriveFile(storagePath: string, encoding: BufferEncoding): Promise<string>;
async function readStoredDriveFile(storagePath: string, encoding?: BufferEncoding) {
  try {
    return encoding ? await readFile(storagePath, encoding) : await readFile(storagePath);
  } catch (error) {
    if (
      typeof error === "object"
      && error !== null
      && "code" in error
      && (error as { code?: unknown }).code === "ENOENT"
    ) {
      throw new DrivePageServiceError(404, "网盘文件已不存在，请重新上传或查看历史记录。", "drive_file_missing");
    }
    throw error;
  }
}

type DriveRouteFile = Awaited<ReturnType<DrivePageService["file"]>>;

function parsedTextFallback(file: DriveRouteFile, encoding?: BufferEncoding) {
  if (file.parsedText === undefined) {
    throw new DrivePageServiceError(404, "网盘文件已不存在，请重新上传或查看历史记录。", "drive_file_missing");
  }
  return encoding ? file.parsedText : Buffer.from(file.parsedText, "utf8");
}

function readDriveFileContent(file: DriveRouteFile): Promise<Buffer>;
function readDriveFileContent(file: DriveRouteFile, encoding: BufferEncoding): Promise<string>;
async function readDriveFileContent(file: DriveRouteFile, encoding?: BufferEncoding) {
  try {
    return encoding ? await readStoredDriveFile(file.storagePath, encoding) : await readStoredDriveFile(file.storagePath);
  } catch (error) {
    if (error instanceof DrivePageServiceError && error.code === "drive_file_missing") {
      return parsedTextFallback(file, encoding);
    }
    throw error;
  }
}

function parsedTextFromBytes(bytes: Buffer, filename: string, mime = "") {
  if (!mime.toLowerCase().startsWith("text/") && !textLikeDriveFile.test(filename)) {
    return undefined;
  }
  return bytes.toString("utf8").slice(0, parsedTextLimit);
}

async function persistDriveUploadBytes(input: {
  bytes: Buffer;
  filename: string;
  projectId: string;
  settings: Pick<Settings, "dataDir">;
}) {
  const storageRoot = path.resolve(input.settings.dataDir, "project-drive", "uploads");
  const storagePath = path.join(storageRoot, input.projectId, randomUUID(), storageFilename(input.filename));
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, input.bytes);
  return storagePath;
}

async function readUploadBody(
  c: Context<AuthEnv>,
  input: { projectId: string; settings: Pick<Settings, "dataDir"> }
): Promise<ParsedDriveUpload> {
  if (headerIncludes(c.req.header("Content-Type"), "multipart/form-data")) {
    const form = await c.req.raw.formData();
    const file = form.get("file");
    if (!isBlobLike(file)) {
      throw new DrivePageServiceError(400, "请选择要上传的文件。", "drive_file_missing");
    }
    const filename = displayFilename(formString(form.get("filename")) || file.name || "upload.bin");
    const mime = formString(form.get("mime")) || file.type || "application/octet-stream";
    const bytes = Buffer.from(await file.arrayBuffer());
    const parsedText = formString(form.get("parsed_text")) || parsedTextFromBytes(bytes, filename, mime);
    const metadata = uploadDriveFileSchema.parse({
      filename,
      mime,
      size_bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      ...(parsedText ? { parsed_text: parsedText } : {})
    });
    const storagePath = await persistDriveUploadBytes({ bytes, filename: metadata.filename, projectId: input.projectId, settings: input.settings });
    return {
      filename: metadata.filename,
      ...(metadata.mime ? { mime: metadata.mime } : {}),
      ...(metadata.size_bytes !== undefined ? { sizeBytes: metadata.size_bytes } : {}),
      storagePath,
      ...(metadata.sha256 ? { sha256: metadata.sha256 } : {}),
      ...(metadata.parsed_text ? { parsedText: metadata.parsed_text } : {})
    };
  }

  const body = uploadDriveFileSchema.parse(await readJsonObject(c));
  if (!body.parsed_text?.trim()) {
    throw new DrivePageServiceError(
      400,
      "JSON 上传必须包含文件内容 parsed_text；如果要上传本地文件，请使用文件选择器。",
      "drive_file_content_missing"
    );
  }
  const bytes = body.parsed_text ? Buffer.from(body.parsed_text, "utf8") : undefined;
  const storagePath = bytes
    ? await persistDriveUploadBytes({ bytes, filename: body.filename, projectId: input.projectId, settings: input.settings })
    : undefined;
  return {
    filename: body.filename,
    ...(body.mime ? { mime: body.mime } : {}),
    ...(bytes ? { sizeBytes: bytes.byteLength } : body.size_bytes !== undefined ? { sizeBytes: body.size_bytes } : {}),
    ...(storagePath ? { storagePath } : {}),
    ...(bytes ? { sha256: createHash("sha256").update(bytes).digest("hex") } : body.sha256 ? { sha256: body.sha256 } : {}),
    ...(body.parsed_text ? { parsedText: body.parsed_text } : {})
  };
}

export function createDriveRoutes(deps: DriveRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const drivePages = deps.drivePages ?? getDefaultDrivePageService();
  const runtimeSettings = deps.settings ?? defaultSettings;

  routes.get("/projects/:projectId/items/:itemId/download", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const projectId = requireUuidParam(c.req.param("projectId"), "项目");
      const itemId = requireUuidParam(c.req.param("itemId"), "文件");
      const file = await drivePages.file({
        actor: c.var.actor,
        projectId,
        itemId
      });
      const content = await readDriveFileContent(file);
      return c.body(content, 200, {
        "Content-Type": file.mime ?? "application/octet-stream",
        "Content-Length": String(content.byteLength),
        "Content-Disposition": contentDisposition(file.filename)
      });
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.get("/projects/:projectId/items/:itemId/preview", createCurrentUserMiddleware(authSource), async (c) => {
    try {
      const projectId = requireUuidParam(c.req.param("projectId"), "项目");
      const itemId = requireUuidParam(c.req.param("itemId"), "文件");
      const file = await drivePages.file({
        actor: c.var.actor,
        projectId,
        itemId
      });
      if (!isTextPreview(file.filename, file.mime)) {
        return c.json({
          ok: false,
          error: {
            code: "drive_preview_unsupported",
            message: "这类网盘文件暂不支持在线预览，请下载查看。"
          }
        }, 415);
      }
      const text = await readDriveFileContent(file, "utf8");
      const maxPreviewChars = 200_000;
      return c.json({
        ok: true,
        data: {
          id: file.id,
          item_id: file.itemId,
          filename: file.filename,
          ...(file.mime ? { mime: file.mime } : {}),
          size_bytes: file.sizeBytes,
          preview_type: "text",
          text: text.slice(0, maxPreviewChars),
          truncated: text.length > maxPreviewChars,
          download_href: `/api/drive/projects/${projectId}/items/${itemId}/download`
        }
      });
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.post("/projects/:projectId/files", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    let storagePathForCleanup: string | undefined;
    try {
      const projectId = requireUuidParam(c.req.param("projectId"), "项目");
      const page = await drivePages.page({
        actor: c.var.actor,
        projectId,
        locale
      });
      if (!page.project) {
        throw new DrivePageServiceError(404, "没有找到这个项目网盘。", "drive_not_found");
      }
      if (!page.can_manage) {
        throw new DrivePageServiceError(403, "你没有权限管理这个项目网盘。", "drive_forbidden");
      }
      const body = await readUploadBody(c, { projectId, settings: runtimeSettings });
      storagePathForCleanup = body.storagePath;
      const data = await drivePages.uploadFile({
        actor: c.var.actor,
        projectId,
        filename: body.filename,
        ...(body.mime ? { mime: body.mime } : {}),
        ...(body.sizeBytes !== undefined ? { sizeBytes: body.sizeBytes } : {}),
        ...(body.storagePath ? { storagePath: body.storagePath } : {}),
        ...(body.sha256 ? { sha256: body.sha256 } : {}),
        ...(body.parsedText ? { parsedText: body.parsedText } : {})
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (storagePathForCleanup) {
        await rm(storagePathForCleanup, { force: true }).catch(() => undefined);
      }
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.post("/projects/:projectId/items/:itemId/delete", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const body = driveDeleteSchema.parse(await readJsonObject(c));
      const data = await drivePages.deleteItem({
        actor: c.var.actor,
        projectId: requireUuidParam(c.req.param("projectId"), "项目"),
        itemId: requireUuidParam(c.req.param("itemId"), "文件"),
        ...(body.expected_current_version_id !== undefined ? { expectedCurrentVersionId: body.expected_current_version_id } : {})
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.post("/projects/:projectId/items/:itemId/restore", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await drivePages.restoreItem({
        actor: c.var.actor,
        projectId: requireUuidParam(c.req.param("projectId"), "项目"),
        itemId: requireUuidParam(c.req.param("itemId"), "文件")
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.post("/projects/:projectId/comments/:commentId/draft", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await drivePages.commentToDraft({
        actor: c.var.actor,
        projectId: requireUuidParam(c.req.param("projectId"), "项目"),
        commentId: requireUuidParam(c.req.param("commentId"), "评论")
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  routes.post("/workitems/:workItemId/proposal-draft", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const data = await drivePages.draftToProposal({
        actor: c.var.actor,
        locale,
        workItemId: requireUuidParam(c.req.param("workItemId"), "事项")
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  return routes;
}
