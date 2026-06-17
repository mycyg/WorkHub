import { Hono, type Context } from "hono";
import { z } from "zod";

import { normalizeWorkHubLocale, type DrivePageVM, type WorkItemDetailVM } from "@workhub/contracts";

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

export type DriveRoutesDependencies = {
  auth?: AuthDependencySource;
  drivePages?: DrivePageService;
};

const uploadDriveFileSchema = z.object({
  filename: z.string().trim().min(1).max(256),
  mime: z.string().trim().min(1).max(128).optional(),
  size_bytes: z.number().int().nonnegative().optional(),
  sha256: z.string().length(64).optional(),
  parsed_text: z.string().max(200_000).optional()
});

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
const uuidParamSchema = z.uuid();
function requireUuidParam(value: string, label: string): string {
  if (!uuidParamSchema.safeParse(value).success) {
    throw new DrivePageServiceError(404, `没有找到这个${label}。`, "not_found");
  }
  return value;
}

async function readJsonObject(c: { req: { json: () => Promise<unknown> } }) {
  try {
    const value = await c.req.json();
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function createDriveRoutes(deps: DriveRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const drivePages = deps.drivePages ?? getDefaultDrivePageService();

  routes.post("/projects/:projectId/files", createCurrentUserMiddleware(authSource), async (c) => {
    const locale = requestLocale(c);
    try {
      const body = uploadDriveFileSchema.parse(await readJsonObject(c));
      const data = await drivePages.uploadFile({
        actor: c.var.actor,
        projectId: requireUuidParam(c.req.param("projectId"), "项目"),
        filename: body.filename,
        ...(body.mime ? { mime: body.mime } : {}),
        ...(body.size_bytes !== undefined ? { sizeBytes: body.size_bytes } : {}),
        ...(body.sha256 ? { sha256: body.sha256 } : {}),
        ...(body.parsed_text ? { parsedText: body.parsed_text } : {})
      });
      return c.json(pageEnvelope(data, locale));
    } catch (error) {
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
