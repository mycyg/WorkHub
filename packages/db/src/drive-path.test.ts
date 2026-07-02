import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { resolveDriveFolderPath } from "./repositories/work-items.js";
import { isActivePathUniqueViolation } from "./repositories/drive.js";

test("findings[#low] isActivePathUniqueViolation only matches the active-path unique index 23505", () => {
  assert.equal(
    isActivePathUniqueViolation({ code: "23505", constraint: "project_drive_items_active_path_uq" }),
    true
  );
  // 其它唯一索引 / 外键 / 缺约束名 / 非对象都不算名字冲突。
  assert.equal(isActivePathUniqueViolation({ code: "23505", constraint: "some_other_uq" }), false);
  assert.equal(isActivePathUniqueViolation({ code: "23503" }), false);
  assert.equal(isActivePathUniqueViolation({ code: "23505" }), false);
  assert.equal(isActivePathUniqueViolation(new Error("boom")), false);
  assert.equal(isActivePathUniqueViolation(null), false);
});

test("recordDraftProposal locks the drive comment before the idempotency gate", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async recordDraftProposal");
  assert.notEqual(start, -1);
  const body = source.slice(start);
  assert.match(
    body,
    /from\(projectDriveComments\)[\s\S]*\.for\("update"\)[\s\S]*const comment = commentRows\[0\]/u
  );
});

test("recordDraftProposal does not resurrect dismissed drive comments", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async recordDraftProposal");
  const end = source.indexOf("result = { comment: updatedComment, operation }", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /inArray\(projectDriveComments\.status,\s*\["draft_created",\s*"proposal_created"\]\)/u);
});

test("recordDraftProposal idempotency does not depend on the recent operations window", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("if (comment.status === \"proposal_created\")");
  const end = source.indexOf("const updatedComments = await tx", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.equal(body.includes("sql`${projectDriveOperations.payloadJson}->>'drive_comment_id' = ${comment.id}`"), true);
  assert.equal(body.includes("sql`${projectDriveOperations.payloadJson}->>'work_item_id' = ${input.workItemId}`"), true);
  assert.equal(body.includes("sql`${projectDriveOperations.payloadJson}->>'proposal_id' = ${input.proposalId}`"), true);
  assert.doesNotMatch(body, /\.limit\(50\)/u);
});

test("commentToDraft locks and only claims pending drive comments", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async commentToDraft");
  const end = source.indexOf("async recordDraftProposal", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(
    body,
    /from\(projectDriveComments\)[\s\S]*\.for\("update"\)[\s\S]*const comment = commentRows\[0\]/u
  );
  assert.match(
    body,
    /update\(projectDriveComments\)[\s\S]*eq\(projectDriveComments\.status,\s*"pending_llm"\)/u
  );
});

type Node = { id: string; parentId: string | null; name: string };

function mapFetch(nodes: Node[]) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return async (id: string) => byId.get(id);
}

test("findings[#24] resolveDriveFolderPath walks the parent chain (bounded, no full project scan)", async () => {
  const nodes: Node[] = [
    { id: "a", parentId: null, name: "a" },
    { id: "b", parentId: "a", name: "b" },
    { id: "c", parentId: "b", name: "c" }
  ];
  assert.equal(await resolveDriveFolderPath(nodes[2]!, mapFetch(nodes)), "/a/b/c");
});

test("resolveDriveFolderPath returns /name for a root folder", async () => {
  const root: Node = { id: "r", parentId: null, name: "root" };
  assert.equal(await resolveDriveFolderPath(root, mapFetch([root])), "/root");
});

test("resolveDriveFolderPath stops if a parent row is missing", async () => {
  const leaf: Node = { id: "x", parentId: "gone", name: "x" };
  assert.equal(await resolveDriveFolderPath(leaf, mapFetch([leaf])), "/x");
});

test("resolveDriveFolderPath caps depth at 50 levels", async () => {
  const nodes: Node[] = [];
  for (let i = 0; i < 60; i += 1) {
    nodes.push({ id: `n${i}`, parentId: i === 0 ? null : `n${i - 1}`, name: `n${i}` });
  }
  const path = await resolveDriveFolderPath(nodes[59]!, mapFetch(nodes));
  assert.equal(path.split("/").filter(Boolean).length, 50);
});

test("resolveDriveFolderPath breaks parent cycles instead of looping forever", async () => {
  const nodes: Node[] = [
    { id: "a", parentId: "b", name: "a" },
    { id: "b", parentId: "a", name: "b" }
  ];
  // a -> b -> (a already seen) stop.
  assert.equal(await resolveDriveFolderPath(nodes[0]!, mapFetch(nodes)), "/b/a");
});

test("accepted deliverable reads only attach versions belonging to the accepted drive item", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "work-items.ts"), "utf8");
  const versionJoinCount = (source.match(/leftJoin\(projectDriveVersions/gu) ?? []).length;
  const scopedJoinCount = (source.match(/leftJoin\(projectDriveVersions,\s*acceptedDriveVersionJoinCondition\(\)\)/gu) ?? []).length;

  assert.ok(versionJoinCount >= 4);
  assert.equal(scopedJoinCount, versionJoinCount);
  assert.match(source, /eq\(projectDriveVersions\.itemId,\s*acceptedDeliverableChanges\.driveItemId\)/u);
});

test("accepted deliverable restore creates a fresh current row for the requesting work item", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "work-items.ts"), "utf8");
  const start = source.indexOf("async restoreAcceptedDeliverable");
  const end = source.indexOf("async searchKnowledge", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /insert\(acceptedDeliverableChanges\)[\s\S]*workItemId:\s*current\.accepted\.workItemId/u);
  assert.match(body, /acceptedVersion:\s*current\.accepted\.acceptedVersion\s*\+\s*1/u);
  assert.match(body, /source_accepted_change_id:\s*previous\.accepted\.id/u);
  assert.doesNotMatch(body, /set\(\{\s*supersededAt:\s*null/u);
});

test("accepted deliverable restore does not choose a previous version from a recycled drive item", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "work-items.ts"), "utf8");
  const start = source.indexOf("async restoreAcceptedDeliverable");
  const end = source.indexOf("async searchKnowledge", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);
  const previousRowsStart = body.indexOf("const previousRows = await tx");
  const previousRowsEnd = body.indexOf("const previous = previousRows[0]", previousRowsStart);
  assert.notEqual(previousRowsStart, -1);
  assert.notEqual(previousRowsEnd, -1);
  const previousRowsQuery = body.slice(previousRowsStart, previousRowsEnd);

  assert.match(previousRowsQuery, /isNull\(projectDriveItems\.deletedAt\)/u);
  assert.match(previousRowsQuery, /isNotNull\(projectDriveItems\.id\)/u);
});

test("accepted deliverable restore reports a superseded current id as version changed", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "work-items.ts"), "utf8");
  const start = source.indexOf("async restoreAcceptedDeliverable");
  const end = source.indexOf("const previousRows = await tx", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /const staleRows = await tx/u);
  assert.match(body, /eq\(acceptedDeliverableChanges\.id,\s*input\.acceptedChangeId\)/u);
  assert.match(body, /eq\(acceptedDeliverableChanges\.workItemId,\s*input\.workItemId\)/u);
  assert.match(body, /staleRows\[0\]\?\.supersededAt/u);
  assert.match(body, /"deliverable_version_changed"/u);
});

test("accepted deliverable reads attach explicit restore availability", () => {
  const workItemSource = readFileSync(join(process.cwd(), "src", "repositories", "work-items.ts"), "utf8");
  const driveSource = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");

  assert.match(workItemSource, /function attachAcceptedDeliverableRestoreState/u);
  assert.match(workItemSource, /canRestore/u);
  assert.match(workItemSource, /lt\(acceptedDeliverableChanges\.acceptedVersion,\s*row\.accepted\.acceptedVersion\)/u);
  assert.match(workItemSource, /isNull\(projectDriveItems\.deletedAt\)/u);
  assert.match(workItemSource, /acceptedDeliverables:\s*await attachAcceptedDeliverableRestoreState/u);
  assert.match(driveSource, /attachAcceptedDeliverableRestoreState/u);
});

test("drive page accepted deliverables only attach versions belonging to their drive item", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const acceptedStart = source.indexOf(".from(acceptedDeliverableChanges)");
  assert.notEqual(acceptedStart, -1);
  const acceptedBlock = source.slice(acceptedStart, source.indexOf("// M12", acceptedStart));

  assert.match(acceptedBlock, /leftJoin\(projectDriveVersions,\s*acceptedDriveVersionJoinCondition\(\)\)/u);
  assert.match(source, /eq\(projectDriveVersions\.itemId,\s*acceptedDeliverableChanges\.driveItemId\)/u);
});

test("drive page readPage keeps superseded accepted rows for historical version labels", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const acceptedStart = source.indexOf(".from(acceptedDeliverableChanges)");
  const acceptedEnd = source.indexOf(".orderBy(desc(acceptedDeliverableChanges.createdAt))", acceptedStart);
  assert.notEqual(acceptedStart, -1);
  assert.notEqual(acceptedEnd, -1);
  const acceptedBlock = source.slice(acceptedStart, acceptedEnd);

  assert.doesNotMatch(acceptedBlock, /isNull\(acceptedDeliverableChanges\.supersededAt\)/u);
});

test("drive page readPage backfills current versions for every loaded file item", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async readPage");
  const end = source.indexOf("async listRecentFilesByProject", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /missingLoadedCurrentVersionIds/u);
  assert.match(body, /loadedItemsForVersionBackfill\s*\.map\(\(item\) => item\.currentVersionId\)/u);
  assert.match(body, /where\(inArray\(projectDriveVersions\.id,\s*missingLoadedCurrentVersionIds\)\)/u);
});

test("drive page readPage backfills current versions for recycle-bin file items", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async readPage");
  const end = source.indexOf("async listRecentFilesByProject", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /loadedItemsForVersionBackfill\s*=\s*\[\.\.\.items,\s*\.\.\.deletedItems\]/u);
  assert.match(body, /loadedItemsForVersionBackfill\s*\.map\(\(item\) => item\.currentVersionId\)/u);
});

test("drive page readPage can hydrate a deleted target item into the recycle-bin slice", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async readPage");
  const end = source.indexOf("async listRecentFilesByProject", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /targetDeletedSeeds/u);
  assert.match(body, /input\.includeDeleted/u);
  assert.match(body, /deletedItems\s*=\s*\[/u);
  assert.match(body, /targetChain\.filter\(\(item\) => !item\.deletedAt/u);
});

test("drive page readPage hydrates deleted target ancestors into the recycle-bin slice", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("const targetChainSeeds = [...targetSeeds, ...targetDeletedSeeds]");
  const end = source.indexOf("const knownLoadedVersionIds", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.doesNotMatch(body, /isNull\(projectDriveItems\.deletedAt\)/u);
  assert.match(body, /targetChain\.filter\(\(item\) => item\.deletedAt/u);
  assert.match(body, /deletedItems\s*=\s*\[\s*\.\.\.deletedItems,[\s\S]*targetDeletedAncestors/u);
});

test("drive page readPage blocks child restore links when the deleted parent is outside the loaded slice", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("const parentIds = [...new Set(deletedItems");
  const end = source.indexOf("return {", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  // db-repos-5：restoreBlocked 判定改为批量查询（parentRowsById 一次 inArray 取回全部父行），
  // 逐行仍按「父行缺失或已删」拦截还原——只是不再逐条串行查询。
  assert.match(body, /parentRowsById/u);
  assert.match(body, /!parentRow \|\| parentRow\.deletedAt/u);
  assert.match(body, /restoreBlockedItemIds\.push\(item\.id\)/u);
});

test("softDeleteItem folder emptiness checks only same-project children", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async softDeleteItem");
  const end = source.indexOf("async restoreDeletedItem", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);
  const childCheckStart = body.indexOf("const childRows = await tx");
  assert.notEqual(childCheckStart, -1);
  const childCheck = body.slice(childCheckStart, body.indexOf("if (childRows[0])", childCheckStart));

  assert.match(childCheck, /eq\(projectDriveItems\.parentId,\s*item\.id\)/u);
  assert.match(childCheck, /eq\(projectDriveItems\.projectId,\s*input\.projectId\)/u);
  assert.match(childCheck, /isNull\(projectDriveItems\.deletedAt\)/u);
});

test("drive page readPage backfills accepted-deliverable locks for every loaded drive item", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async readPage");
  const end = source.indexOf("async listRecentFilesByProject", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /loadedItemIds/u);
  assert.match(body, /knownAcceptedDeliverableIds/u);
  assert.match(body, /inArray\(acceptedDeliverableChanges\.driveItemId,\s*loadedItemIds\)/u);
  assert.match(body, /!knownAcceptedDeliverableIds\.has\(row\.accepted\.id\)/u);
});

test("drive page readPage backfills pending comments beyond the newest comment slice", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async readPage");
  const end = source.indexOf("const draftWorkItemIds", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /let comments = initialComments/u);
  assert.match(body, /knownCommentIds/u);
  assert.match(body, /eq\(projectDriveComments\.status,\s*"pending_llm"\)/u);
  assert.match(body, /!knownCommentIds\.has\(comment\.id\)/u);
});

test("recent project files carry accepted-deliverable work item ids for page-level link filtering", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async listRecentFilesByProject");
  const end = source.indexOf("async countFilesByProject", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /acceptedDeliverableChanges\.driveItemId/u);
  assert.match(body, /acceptedDeliverableChanges\.workItemId/u);
  assert.match(body, /isNull\(acceptedDeliverableChanges\.supersededAt\)/u);
  assert.match(body, /acceptedWorkItemIds/u);
});

test("recent project files only expose accepted work items for the current file version", () => {
  const source = readFileSync(join(process.cwd(), "src", "repositories", "drive.ts"), "utf8");
  const start = source.indexOf("async listRecentFilesByProject");
  const end = source.indexOf("async countFilesByProject", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);

  assert.match(body, /currentVersionId:\s*projectDriveItems\.currentVersionId/u);
  assert.match(body, /currentVersionIds/u);
  assert.match(body, /inArray\(acceptedDeliverableChanges\.driveVersionId,\s*currentVersionIds\)/u);
});
