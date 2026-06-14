import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { settings as defaultSettings, type Settings } from "@workhub/config";
import {
  createDatabaseClient,
  createDriveRepository,
  createWorkItemRepository,
  type WorkHubDatabaseClient,
  type WorkItemDataRepository
} from "@workhub/db";
import { safeResolvePath } from "@workhub/tools";

// P-COLLAB M1：项目级文件范围。把项目现有 Drive 文件物化进 workdir/project/（只读参考区），
// 让 AI 工人能读"整个项目"，而不是只看本任务的空沙箱。outputs/ 仍是唯一可写产出区（manifest 只扫 outputs/）。
export type ProjectDriveFile = { path: string; storagePath: string; sizeBytes: number };

export type ProjectHydrateDeps = {
  listProjectFiles: (projectId: string) => Promise<ProjectDriveFile[]>;
  readFileBytes: (storagePath: string) => Promise<Buffer>;
  writeFile: (absPath: string, data: Buffer) => Promise<void>;
  ensureDir: (absDir: string) => Promise<void>;
};

export type HydrateOptions = { maxFiles?: number; maxBytes?: number };
export type HydrateResult = { files: number; bytes: number; skipped: number };

const DEFAULT_MAX_FILES = 200;
const DEFAULT_MAX_BYTES = 32 * 1024 * 1024;

// 纯函数 + 可注入依赖（便于单测）。预算上限防爆；每个目标路径过 safeResolvePath 防逃逸；
// 逐文件 try 防单个坏文件连累整体（fail-open）。
export async function hydrateProjectWorkdir(
  workdir: string,
  projectId: string,
  deps: ProjectHydrateDeps,
  options: HydrateOptions = {}
): Promise<HydrateResult> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const root = path.join(workdir, "project");
  let files = 0;
  let bytes = 0;
  let skipped = 0;

  const list = await deps.listProjectFiles(projectId);
  for (const file of list) {
    if (files >= maxFiles || bytes + Math.max(0, file.sizeBytes) > maxBytes) {
      skipped += 1;
      continue;
    }
    let target: string;
    try {
      target = safeResolvePath(root, file.path); // 恶意/异常文件名不得逃出 project/
    } catch {
      skipped += 1;
      continue;
    }
    try {
      const data = await deps.readFileBytes(file.storagePath);
      await deps.ensureDir(path.dirname(target));
      await deps.writeFile(target, data);
      files += 1;
      bytes += data.length;
    } catch {
      skipped += 1; // 文件已不存在等 → 跳过，不中断
    }
  }
  return { files, bytes, skipped };
}

function buildDefaultDeps(db: WorkHubDatabaseClient["db"]): ProjectHydrateDeps {
  const drive = createDriveRepository(db);
  return {
    listProjectFiles: async (projectId) => {
      const page = await drive.readPage({ projectId, includeDeleted: false });
      const versionsById = new Map(page.versions.map((version) => [version.id, version]));
      const itemsById = new Map(page.items.map((item) => [item.id, item]));
      const out: ProjectDriveFile[] = [];
      for (const item of page.items) {
        if (item.kind !== "file" || !item.currentVersionId) {
          continue;
        }
        const version = versionsById.get(item.currentVersionId);
        if (!version?.storagePath) {
          continue;
        }
        // 从 parentId 链重建相对路径：文件夹/.../文件名。
        const segments = [item.name];
        let parentId = item.parentId;
        let guard = 0;
        while (parentId && guard < 64) {
          const parent = itemsById.get(parentId);
          if (!parent) {
            break;
          }
          segments.unshift(parent.name);
          parentId = parent.parentId;
          guard += 1;
        }
        out.push({
          path: segments.join("/"),
          storagePath: version.storagePath,
          sizeBytes: Number(version.sizeBytes ?? 0)
        });
      }
      return out;
    },
    readFileBytes: (storagePath) => readFile(storagePath),
    writeFile: (absPath, data) => writeFile(absPath, data),
    ensureDir: async (absDir) => {
      await mkdir(absDir, { recursive: true });
    }
  };
}

export type ProjectHydrator = (run: { work_item_id: string }, workdir: string) => Promise<HydrateResult | undefined>;

let defaultDbClient: WorkHubDatabaseClient | undefined;
let defaultWorkItems: WorkItemDataRepository | undefined;
let defaultDeps: ProjectHydrateDeps | undefined;

// 默认 hydrator：run → work_item → projectId → 物化项目文件。任何失败都 fail-open（run 照常以空 workdir 跑）。
export function getDefaultProjectHydrator(settings: Settings = defaultSettings): ProjectHydrator {
  return async (run, workdir) => {
    try {
      defaultDbClient = defaultDbClient ?? createDatabaseClient();
      defaultWorkItems = defaultWorkItems ?? createWorkItemRepository(defaultDbClient.db);
      defaultDeps = defaultDeps ?? buildDefaultDeps(defaultDbClient.db);
      const detail = await defaultWorkItems.readWorkItemDetail(run.work_item_id);
      const projectId = detail?.workItem.projectId;
      if (!projectId) {
        return undefined;
      }
      return await hydrateProjectWorkdir(workdir, projectId, defaultDeps, {
        maxFiles: settings.agentRun.projectHydrateMaxFiles,
        maxBytes: settings.agentRun.projectHydrateMaxBytes
      });
    } catch {
      return undefined;
    }
  };
}
