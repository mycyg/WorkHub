import { randomUUID } from "node:crypto";

import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { ConversationVisibility } from "@workhub/contracts";

import type { WorkHubDb } from "../client.js";
import {
  conversationMessages,
  conversationParticipants,
  projectConversations,
  projects,
  workspaceMemberships
} from "../schema/index.js";

export type ConversationRow = typeof projectConversations.$inferSelect;
export type ConversationParticipantRow = typeof conversationParticipants.$inferSelect;
export type ConversationMessageRow = typeof conversationMessages.$inferSelect;
export type ConversationParticipantRole = "owner" | "member";

export type VisibleConversationRow = ConversationRow & {
  participantRole: ConversationParticipantRole | null;
};

export type ConversationAccessRecord = {
  conversation: ConversationRow;
  projectOwnerUserId: string | null;
  membershipRole: string;
  participantRole: ConversationParticipantRole | null;
};

export type ListVisibleConversationsInput = {
  workspaceId: string;
  viewerUserId: string;
  projectId: string;
  after?: ConversationListCursor;
  limit: number;
};

export type ConversationListCursor = {
  createdAt: Date;
  id: string;
};

export type FindConversationAccessInput = {
  workspaceId: string;
  viewerUserId: string;
  conversationId: string;
};

export type CreateCollabConversationInput = {
  id?: string;
  workspaceId: string;
  projectId: string;
  creatorUserId: string;
  title: string;
  visibility: ConversationVisibility;
  parentConversationId?: string;
  sourceMessageId?: string;
  participantUserIds: string[];
  at?: Date;
};

type CreateUserMessageBaseInput = {
  id?: string;
  workspaceId: string;
  conversationId: string;
  senderUserId: string;
  threadRootId?: string;
  at?: Date;
};

export type CreateUserMessageInput = CreateUserMessageBaseInput &
  (
    | { kind: "text"; contentJson: { text: string } }
    | { kind: "file_card"; contentJson: { drive_item_id: string; snapshot_name: string } }
  );

export type ListConversationMessagesInput = {
  workspaceId: string;
  viewerUserId: string;
  conversationId: string;
  afterSeq: number;
  limit: number;
};

export type VisibleConversationListResult = {
  rows: VisibleConversationRow[];
  capped: boolean;
  nextCursor: ConversationListCursor | null;
};

export type CreatedCollabConversation = {
  conversation: ConversationRow;
  participants: ConversationParticipantRow[];
};

export type ConversationMessagePage = {
  rows: ConversationMessageRow[];
  hasMore: boolean;
  nextAfterSeq: number;
};

export type ConversationRepository = {
  listVisibleForProject: (
    input: ListVisibleConversationsInput
  ) => Promise<VisibleConversationListResult | null>;
  findVisibleAccessRecord: (input: FindConversationAccessInput) => Promise<ConversationAccessRecord | null>;
  createCollab: (input: CreateCollabConversationInput) => Promise<CreatedCollabConversation>;
  createUserMessage: (input: CreateUserMessageInput) => Promise<ConversationMessageRow>;
  listMessagesAfter: (input: ListConversationMessagesInput) => Promise<ConversationMessagePage | null>;
};

class NamedConversationRepositoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConversationRepositoryInputError extends NamedConversationRepositoryError {}
export class ConversationAccessDeniedError extends NamedConversationRepositoryError {}
export class ConversationParticipantMembershipError extends NamedConversationRepositoryError {}
export class ConversationParentAccessError extends NamedConversationRepositoryError {}
export class ConversationSourceMessageMismatchError extends NamedConversationRepositoryError {}
export class ConversationInsertFailedError extends NamedConversationRepositoryError {}
export class ConversationParticipantInsertFailedError extends NamedConversationRepositoryError {}
export class ConversationThreadRootMismatchError extends NamedConversationRepositoryError {}
export class ConversationSequenceExhaustedError extends NamedConversationRepositoryError {}
export class ConversationSequenceAllocationError extends NamedConversationRepositoryError {}
export class ConversationMessageInsertFailedError extends NamedConversationRepositoryError {}

const conversationSelection = {
  id: projectConversations.id,
  workspaceId: projectConversations.workspaceId,
  projectId: projectConversations.projectId,
  kind: projectConversations.kind,
  title: projectConversations.title,
  parentConversationId: projectConversations.parentConversationId,
  sourceMessageId: projectConversations.sourceMessageId,
  visibility: projectConversations.visibility,
  nextSeq: projectConversations.nextSeq,
  createdBy: projectConversations.createdBy,
  deletedAt: projectConversations.deletedAt,
  deletedByUserId: projectConversations.deletedByUserId,
  createdAt: projectConversations.createdAt,
  updatedAt: projectConversations.updatedAt
};

const messageSelection = {
  id: conversationMessages.id,
  conversationId: conversationMessages.conversationId,
  seq: conversationMessages.seq,
  senderType: conversationMessages.senderType,
  senderUserId: conversationMessages.senderUserId,
  kind: conversationMessages.kind,
  contentJson: conversationMessages.contentJson,
  threadRootId: conversationMessages.threadRootId,
  createdAt: conversationMessages.createdAt
};

function assertLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new ConversationRepositoryInputError("conversation limit must be an integer from 1 through 100");
  }
}

function assertCursor(afterSeq: number) {
  if (!Number.isSafeInteger(afterSeq) || afterSeq < 0) {
    throw new ConversationRepositoryInputError("conversation cursor must be a non-negative safe integer");
  }
}

function assertConversationListCursor(cursor: ConversationListCursor | undefined) {
  if (!cursor) {
    return;
  }
  if (
    !(cursor.createdAt instanceof Date) ||
    !Number.isFinite(cursor.createdAt.getTime()) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(cursor.id)
  ) {
    throw new ConversationRepositoryInputError(
      "conversation list cursor requires a valid date and UUID"
    );
  }
}

function assertCollabInput(input: CreateCollabConversationInput) {
  if (input.sourceMessageId && !input.parentConversationId) {
    throw new ConversationRepositoryInputError("source message requires a parent conversation");
  }
  if (input.participantUserIds.length > 99) {
    throw new ConversationRepositoryInputError("a collab may request at most 99 members");
  }
  const unique = new Set(input.participantUserIds);
  if (unique.size !== input.participantUserIds.length || unique.has(input.creatorUserId)) {
    throw new ConversationRepositoryInputError("collab participants must be unique and exclude the creator");
  }
}

function assertMessageContent(input: CreateUserMessageInput) {
  const keys = Object.keys(input.contentJson).sort();
  if (input.kind === "text") {
    if (keys.length !== 1 || keys[0] !== "text" || input.contentJson.text.length === 0) {
      throw new ConversationRepositoryInputError("text messages require only non-empty text metadata");
    }
    return;
  }
  if (
    keys.length !== 2 ||
    keys[0] !== "drive_item_id" ||
    keys[1] !== "snapshot_name" ||
    input.contentJson.drive_item_id.length === 0 ||
    input.contentJson.snapshot_name.length === 0
  ) {
    throw new ConversationRepositoryInputError("file cards accept only drive item and snapshot metadata");
  }
}

function visibleConversationCondition() {
  return or(
    eq(projectConversations.kind, "main"),
    and(eq(projectConversations.kind, "collab"), isNotNull(conversationParticipants.id))
  );
}

function activeConversationCondition(input: {
  workspaceId: string;
  viewerUserId: string;
  conversationId?: string;
  projectId?: string;
}) {
  return and(
    eq(projectConversations.workspaceId, input.workspaceId),
    input.conversationId ? eq(projectConversations.id, input.conversationId) : undefined,
    input.projectId ? eq(projectConversations.projectId, input.projectId) : undefined,
    isNull(projectConversations.deletedAt),
    eq(projects.workspaceId, input.workspaceId),
    eq(projects.archived, false),
    isNull(projects.deletedAt),
    eq(workspaceMemberships.workspaceId, input.workspaceId),
    eq(workspaceMemberships.userId, input.viewerUserId),
    isNull(workspaceMemberships.deletedAt),
    visibleConversationCondition()
  );
}

function conversationListCursorCondition(cursor: ConversationListCursor | undefined) {
  if (!cursor) {
    return undefined;
  }
  return or(
    gt(projectConversations.createdAt, cursor.createdAt),
    and(
      eq(projectConversations.createdAt, cursor.createdAt),
      gt(projectConversations.id, cursor.id)
    )
  );
}

async function readVisibleAccess(
  db: WorkHubDb,
  input: FindConversationAccessInput & { projectId?: string },
  lock = false
): Promise<ConversationAccessRecord | null> {
  const query = db
    .select({
      conversation: conversationSelection,
      projectOwnerUserId: projects.ownerUserId,
      membershipRole: workspaceMemberships.role,
      participantRole: conversationParticipants.role
    })
    .from(projectConversations)
    .innerJoin(
      projects,
      and(
        eq(projects.id, projectConversations.projectId),
        eq(projects.workspaceId, projectConversations.workspaceId)
      )
    )
    .innerJoin(
      workspaceMemberships,
      and(
        eq(workspaceMemberships.workspaceId, projectConversations.workspaceId),
        eq(workspaceMemberships.userId, input.viewerUserId),
        isNull(workspaceMemberships.deletedAt)
      )
    )
    .leftJoin(
      conversationParticipants,
      and(
        eq(conversationParticipants.conversationId, projectConversations.id),
        eq(conversationParticipants.userId, input.viewerUserId)
      )
    )
    .where(activeConversationCondition(input))
    .limit(1);
  const rows = lock
    ? await query.for("update", { of: projectConversations })
    : await query;
  return (rows[0] as ConversationAccessRecord | undefined) ?? null;
}

export function createConversationRepository(db: WorkHubDb): ConversationRepository {
  return {
    async listVisibleForProject(input) {
      assertLimit(input.limit);
      assertConversationListCursor(input.after);
      const rows = await db
        .select({
          ...conversationSelection,
          participantRole: conversationParticipants.role
        })
        .from(projectConversations)
        .innerJoin(
          projects,
          and(
            eq(projects.id, projectConversations.projectId),
            eq(projects.workspaceId, projectConversations.workspaceId)
          )
        )
        .innerJoin(
          workspaceMemberships,
          and(
            eq(workspaceMemberships.workspaceId, projectConversations.workspaceId),
            eq(workspaceMemberships.userId, input.viewerUserId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .leftJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, projectConversations.id),
            eq(conversationParticipants.userId, input.viewerUserId)
          )
        )
        .where(
          and(
            activeConversationCondition(input),
            conversationListCursorCondition(input.after)
          )
        )
        .orderBy(asc(projectConversations.createdAt), asc(projectConversations.id))
        .limit(input.limit + 1);
      if (rows.length === 0) {
        return null;
      }
      const pageRows = rows.slice(0, input.limit).map((row) => ({
          ...(row as ConversationRow),
          participantRole: (row.participantRole as ConversationParticipantRole | null) ?? null
        }));
      const capped = rows.length > input.limit;
      const last = pageRows.at(-1);
      return {
        rows: pageRows,
        capped,
        nextCursor: capped && last ? { createdAt: last.createdAt, id: last.id } : null
      };
    },

    async findVisibleAccessRecord(input) {
      return readVisibleAccess(db, input);
    },

    async createCollab(input) {
      assertCollabInput(input);
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        const [projectAccess] = await tx
          .select({
            projectId: projects.id,
            projectOwnerUserId: projects.ownerUserId,
            membershipRole: workspaceMemberships.role
          })
          .from(projects)
          .innerJoin(
            workspaceMemberships,
            and(
              eq(workspaceMemberships.workspaceId, projects.workspaceId),
              eq(workspaceMemberships.userId, input.creatorUserId),
              isNull(workspaceMemberships.deletedAt)
            )
          )
          .where(
            and(
              eq(projects.id, input.projectId),
              eq(projects.workspaceId, input.workspaceId),
              eq(projects.archived, false),
              isNull(projects.deletedAt),
              eq(workspaceMemberships.workspaceId, input.workspaceId),
              eq(workspaceMemberships.userId, input.creatorUserId),
              isNull(workspaceMemberships.deletedAt)
            )
          )
          .for("update", { of: projects })
          .limit(1);
        if (!projectAccess) {
          throw new ConversationAccessDeniedError("creator cannot access the active project");
        }

        if (input.participantUserIds.length > 0) {
          const activeParticipants = await tx
            .select({ userId: workspaceMemberships.userId })
            .from(workspaceMemberships)
            .where(
              and(
                eq(workspaceMemberships.workspaceId, input.workspaceId),
                inArray(workspaceMemberships.userId, input.participantUserIds),
                isNull(workspaceMemberships.deletedAt)
              )
            );
          const activeIds = new Set(activeParticipants.map((row) => row.userId));
          if (
            activeIds.size !== input.participantUserIds.length ||
            input.participantUserIds.some((userId) => !activeIds.has(userId))
          ) {
            throw new ConversationParticipantMembershipError(
              "every collab participant must be an active workspace member"
            );
          }
        }

        if (input.parentConversationId) {
          const parent = await readVisibleAccess(tx, {
            workspaceId: input.workspaceId,
            viewerUserId: input.creatorUserId,
            conversationId: input.parentConversationId,
            projectId: input.projectId
          });
          if (!parent) {
            throw new ConversationParentAccessError("parent conversation is not visible in this project");
          }
          if (input.sourceMessageId) {
            const [source] = await tx
              .select({ id: conversationMessages.id })
              .from(conversationMessages)
              .where(
                and(
                  eq(conversationMessages.conversationId, input.parentConversationId),
                  eq(conversationMessages.id, input.sourceMessageId)
                )
              )
              .limit(1);
            if (!source) {
              throw new ConversationSourceMessageMismatchError(
                "source message does not belong to the selected parent conversation"
              );
            }
          }
        }

        const [created] = await tx
          .insert(projectConversations)
          .values({
            id: input.id ?? randomUUID(),
            workspaceId: input.workspaceId,
            projectId: input.projectId,
            kind: "collab",
            title: input.title,
            ...(input.parentConversationId ? { parentConversationId: input.parentConversationId } : {}),
            ...(input.sourceMessageId ? { sourceMessageId: input.sourceMessageId } : {}),
            visibility: input.visibility,
            nextSeq: 0,
            createdBy: input.creatorUserId,
            createdAt: at,
            updatedAt: at
          })
          .returning();
        if (!created) {
          throw new ConversationInsertFailedError("collab insert returned no conversation");
        }

        const participantValues = [
          {
            id: randomUUID(),
            conversationId: created.id,
            userId: input.creatorUserId,
            role: "owner" as const,
            createdAt: at,
            updatedAt: at
          },
          ...input.participantUserIds.map((userId) => ({
            id: randomUUID(),
            conversationId: created.id,
            userId,
            role: "member" as const,
            createdAt: at,
            updatedAt: at
          }))
        ];
        const insertedParticipants = await tx
          .insert(conversationParticipants)
          .values(participantValues)
          .returning();
        const expectedParticipantRoles = new Map(
          participantValues.map((row) => [row.userId, row.role])
        );
        if (
          insertedParticipants.length !== participantValues.length ||
          insertedParticipants.some(
            (row) => expectedParticipantRoles.get(row.userId) !== row.role
          )
        ) {
          throw new ConversationParticipantInsertFailedError(
            "collab participant insert returned an incomplete or mismatched set"
          );
        }
        return { conversation: created, participants: insertedParticipants };
      });
    },

    async createUserMessage(input) {
      assertMessageContent(input);
      const at = input.at ?? new Date();
      return db.transaction(async (tx) => {
        const access = await readVisibleAccess(
          tx,
          {
            workspaceId: input.workspaceId,
            viewerUserId: input.senderUserId,
            conversationId: input.conversationId
          },
          true
        );
        if (!access) {
          throw new ConversationAccessDeniedError("sender cannot access the active conversation");
        }

        if (input.threadRootId) {
          const [root] = await tx
            .select({ id: conversationMessages.id })
            .from(conversationMessages)
            .where(
              and(
                eq(conversationMessages.conversationId, input.conversationId),
                eq(conversationMessages.id, input.threadRootId)
              )
            )
            .limit(1);
          if (!root) {
            throw new ConversationThreadRootMismatchError(
              "thread root does not belong to the target conversation"
            );
          }
        }

        const currentSeq = access.conversation.nextSeq;
        if (!Number.isSafeInteger(currentSeq) || currentSeq < 0) {
          throw new ConversationSequenceAllocationError("stored conversation sequence is not a safe integer");
        }
        if (currentSeq >= Number.MAX_SAFE_INTEGER) {
          throw new ConversationSequenceExhaustedError("conversation sequence space is exhausted");
        }
        const [allocation] = await tx
          .update(projectConversations)
          .set({
            nextSeq: sql<number>`${projectConversations.nextSeq} + 1`,
            updatedAt: at
          })
          .where(
            and(
              eq(projectConversations.workspaceId, input.workspaceId),
              eq(projectConversations.id, input.conversationId),
              eq(projectConversations.projectId, access.conversation.projectId),
              eq(projectConversations.nextSeq, currentSeq),
              isNull(projectConversations.deletedAt)
            )
          )
          .returning({ nextSeq: projectConversations.nextSeq });
        const nextSeq = allocation?.nextSeq;
        if (!Number.isSafeInteger(nextSeq) || nextSeq !== currentSeq + 1) {
          throw new ConversationSequenceAllocationError(
            "conversation sequence update returned no exact next sequence"
          );
        }

        const [created] = await tx
          .insert(conversationMessages)
          .values({
            id: input.id ?? randomUUID(),
            conversationId: input.conversationId,
            seq: nextSeq,
            senderType: "user",
            senderUserId: input.senderUserId,
            kind: input.kind,
            contentJson: input.contentJson,
            ...(input.threadRootId ? { threadRootId: input.threadRootId } : {}),
            createdAt: at
          })
          .returning();
        if (!created) {
          throw new ConversationMessageInsertFailedError("message insert returned no row");
        }
        return created;
      });
    },

    async listMessagesAfter(input) {
      assertCursor(input.afterSeq);
      assertLimit(input.limit);
      const access = await readVisibleAccess(db, input);
      if (!access) {
        return null;
      }
      const rows = await db
        .select(messageSelection)
        .from(conversationMessages)
        .innerJoin(projectConversations, eq(projectConversations.id, conversationMessages.conversationId))
        .innerJoin(
          projects,
          and(
            eq(projects.id, projectConversations.projectId),
            eq(projects.workspaceId, projectConversations.workspaceId)
          )
        )
        .innerJoin(
          workspaceMemberships,
          and(
            eq(workspaceMemberships.workspaceId, projectConversations.workspaceId),
            eq(workspaceMemberships.userId, input.viewerUserId),
            isNull(workspaceMemberships.deletedAt)
          )
        )
        .leftJoin(
          conversationParticipants,
          and(
            eq(conversationParticipants.conversationId, projectConversations.id),
            eq(conversationParticipants.userId, input.viewerUserId)
          )
        )
        .where(
          and(
            eq(conversationMessages.conversationId, input.conversationId),
            gt(conversationMessages.seq, input.afterSeq),
            activeConversationCondition(input)
          )
        )
        .orderBy(asc(conversationMessages.seq))
        .limit(input.limit + 1);
      const pageRows = rows.slice(0, input.limit) as ConversationMessageRow[];
      return {
        rows: pageRows,
        hasMore: rows.length > input.limit,
        nextAfterSeq: pageRows.at(-1)?.seq ?? input.afterSeq
      };
    }
  };
}
