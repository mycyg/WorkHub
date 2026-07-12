import { Hono, type Context } from "hono";

import { normalizeWorkHubLocale } from "@workhub/contracts";

import {
  createCurrentUserMiddleware,
  getDefaultAuthDependencies,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";
import { DrivePageServiceError, getDefaultDrivePageService, type DrivePageService } from "../services/drive-pages.js";
import { isUuidParam } from "./uuid-param.js";

// R12 批 6(网盘整合 + git 化):单文件版本历史列表 + 回滚(找回版本,追加新版本不抹历史)。
// 这个路由模块故意 **不挂载** 进 apps/api/src/app.ts——挂载是集成者的活(见
// r12-desktop-workbench/reports/batch-6-drive.md 的「挂载清单」)。照 routes/conversation-army.ts
// (批 5)的既有先例:只导出 createDriveVersionRoutes(deps),不碰 app.ts/openapi.ts。
// 之所以不直接把这两个端点加进既有 routes/drive.ts 的 createDriveRoutes()(它已经在 app.ts 里挂了)：
// 那样端点会立刻变成运行时可达路由，会被 app.test.ts 的「runtime routes 与 openapi.json 保持同步」
// 契约测试判定为「有路由但没文档」而红——那条测试的修复口径就是补 openapi.ts，而 openapi.ts 在本批
// 范围围栏之外。保持未挂载，交给集成者一并处理文档化 + 挂载。

export type DriveVersionRoutesDependencies = {
  auth?: AuthDependencySource;
  drivePages?: DrivePageService;
};

function requestLocale(c: { req: { query: (key: string) => string | undefined; header: (key: string) => string | undefined } }) {
  return normalizeWorkHubLocale(c.req.query("locale") ?? c.req.header("Accept-Language"));
}

// uuid 参数守卫：非法串与「合法但不存在」同一 404 形状，攻击者无法据状态码区分存在性——照
// routes/uuid-param.ts 在 routes/drive.ts/conversation-army.ts 里的既有用法。
function requireUuidParam(value: string, label: string, code: string): string {
  if (!isUuidParam(value)) {
    throw new DrivePageServiceError(404, `没有找到这个${label}。`, code);
  }
  return value;
}

function driveErrorResponse(c: Context<AuthEnv>, error: DrivePageServiceError) {
  return c.json({
    ok: false,
    error: { code: error.code, message: error.message }
  }, error.status);
}

export function createDriveVersionRoutes(deps: DriveVersionRoutesDependencies = {}) {
  const routes = new Hono<AuthEnv>();
  const authSource = deps.auth ?? getDefaultAuthDependencies;
  const drivePages = deps.drivePages ?? getDefaultDrivePageService();
  const requireCurrentUser = createCurrentUserMiddleware(authSource);

  // 批 6(网盘整合 + git 化):单文件版本历史——时间/操作者/大小，读权限同 drivePages.file()。
  routes.get("/projects/:projectId/items/:itemId/versions", requireCurrentUser, async (c) => {
    const locale = requestLocale(c);
    try {
      const projectId = requireUuidParam(c.req.param("projectId"), "项目", "drive_not_found");
      const itemId = requireUuidParam(c.req.param("itemId"), "文件", "drive_file_not_found");
      if (!drivePages.listVersions) {
        throw new DrivePageServiceError(404, "没有找到这个网盘文件的版本历史。", "drive_versions_unavailable");
      }
      const rawLimit = Number.parseInt(c.req.query("limit") ?? "", 10);
      const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : undefined;
      const data = await drivePages.listVersions({
        actor: c.var.actor,
        projectId,
        itemId,
        locale,
        ...(limit !== undefined ? { limit } : {})
      });
      return c.json({ ok: true, data, meta: { locale } });
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  // 批 6:回滚=追加新版本（不抹历史）。用户面「找回这个版本」——文案在前端，端点内部字段仍叫
  // restore，与既有 restore_version op_type/restore_item 端点同一套命名习惯，不是面向用户的黑话。
  routes.post("/projects/:projectId/items/:itemId/versions/:versionId/restore", requireCurrentUser, async (c) => {
    const locale = requestLocale(c);
    try {
      const projectId = requireUuidParam(c.req.param("projectId"), "项目", "drive_not_found");
      const itemId = requireUuidParam(c.req.param("itemId"), "文件", "drive_file_not_found");
      const versionId = requireUuidParam(c.req.param("versionId"), "版本", "drive_version_not_found");
      if (!drivePages.rollbackVersion) {
        throw new DrivePageServiceError(404, "没有找到这个网盘文件的版本历史。", "drive_versions_unavailable");
      }
      const data = await drivePages.rollbackVersion({
        actor: c.var.actor,
        projectId,
        itemId,
        targetVersionId: versionId,
        locale
      });
      return c.json({ ok: true, data, meta: { locale } });
    } catch (error) {
      if (error instanceof DrivePageServiceError) {
        return driveErrorResponse(c, error);
      }
      throw error;
    }
  });

  return routes;
}
