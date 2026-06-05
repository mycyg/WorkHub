import type { SnapshotHook } from "@workhub/tools";

import { takeFileSnapshot, revertFileSnapshot } from "./file-snapshot.js";
import type { RevertSnapshotInput, SnapshotTakeInput } from "./types.js";

export type SnapshotServiceOptions = {
  snapshotRoot: string;
  now?: () => Date;
  id?: () => string;
};

export class SnapshotService {
  constructor(private readonly options: SnapshotServiceOptions) {}

  async takeSandboxFileSnapshot(input: Omit<SnapshotTakeInput, "snapshotRoot" | "now" | "id">) {
    return takeFileSnapshot({
      ...input,
      snapshotRoot: this.options.snapshotRoot,
      ...(this.options.now ? { now: this.options.now } : {}),
      ...(this.options.id ? { id: this.options.id } : {})
    });
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
