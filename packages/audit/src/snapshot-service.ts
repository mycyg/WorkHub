import path from "node:path";

import type { SnapshotHook } from "@workhub/tools";

import { takeFileSnapshot, revertFileSnapshot } from "./file-snapshot.js";
import type { RevertSnapshotInput, SnapshotTakeInput } from "./types.js";

export type SnapshotServiceOptions = {
  snapshotRoot: string;
  now?: () => Date;
  id?: () => string;
};

export class SnapshotService {
  // CORE-04：每 workdir 记上一份快照的 (contentSha256, ref)。同一 run 内连续的 side-effect 工具调用
  // 大多不改变工作区（read 类或失败调用），内容哈希相同则复用 ref、跳过整树拷贝。
  private readonly lastSnapshotByWorkdir = new Map<string, { contentSha256: string; ref: string }>();

  constructor(private readonly options: SnapshotServiceOptions) {}

  async takeSandboxFileSnapshot(input: Omit<SnapshotTakeInput, "snapshotRoot" | "now" | "id">) {
    const workdirKey = path.resolve(input.workdir);
    const snapshot = await takeFileSnapshot({
      ...input,
      snapshotRoot: this.options.snapshotRoot,
      ...(this.options.now ? { now: this.options.now } : {}),
      ...(this.options.id ? { id: this.options.id } : {}),
      ...(this.lastSnapshotByWorkdir.has(workdirKey)
        ? { reuseIfUnchanged: this.lastSnapshotByWorkdir.get(workdirKey)! }
        : {})
    });
    if (snapshot.contentSha256) {
      this.lastSnapshotByWorkdir.set(workdirKey, { contentSha256: snapshot.contentSha256, ref: snapshot.ref });
    }
    return snapshot;
  }

  async revert(input: RevertSnapshotInput) {
    return revertFileSnapshot(input);
  }

  asToolSnapshotHook(input: {
    workItemId: string;
    branchId?: string;
    createdByKind: "ai" | "human" | "system";
  }): SnapshotHook {
    return async (ctx) => {
      const snapshot = await this.takeSandboxFileSnapshot({
        workItemId: input.workItemId,
        ...(input.branchId ? { branchId: input.branchId } : {}),
        workdir: ctx.workdir,
        kind: "pre_step",
        createdByKind: input.createdByKind
      });
      return { snapshotId: snapshot.id };
    };
  }
}

export function createSnapshotService(options: SnapshotServiceOptions) {
  return new SnapshotService(options);
}
