// WorkHub 桌面 · R16-W4b2（中栏「已打开会话」tab 条）：localStorage 持久化（每用户 · 工作区维度）。
// 键 = workhub_wb_open_tabs:<workspaceId>:<userId>——工作台三个窗口同源（见 pending-deep-link.ts），
// localStorage 跨窗口共享，用工作区 + 用户双段隔离，避免换用户/换工作区把上一份 tab 串进来。
// 只持久化重建集合必需的字段（kind/conversationId/projectId/title/lastActiveAt）；unread 不入库
//（恢复后由 refreshTabs 从活数据重算，避免落一份会过期的未读快照）。恢复时对形状做防御式校验，坏条目
// 静默丢弃；「会话是否仍可见」的校验是持续进行的（refreshTabs 在到达对应项目/DM 列表就绪时静默剔除失效
// 的那条），不在这里一次性做（这里手上没有别的项目的 vm，无从校验跨项目 tab）。

import { MAX_OPEN_CONVERSATION_TABS, type OpenConversationTab, type OpenConversationTabKind } from "./model.js";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const STORAGE_PREFIX = "workhub_wb_open_tabs";
const VALID_KINDS: readonly OpenConversationTabKind[] = ["main", "collab", "dm"];

export function openTabsStorageKey(workspaceId: string, userId: string): string {
  return `${STORAGE_PREFIX}:${workspaceId}:${userId}`;
}

function isKind(value: unknown): value is OpenConversationTabKind {
  return typeof value === "string" && (VALID_KINDS as readonly string[]).includes(value);
}

function parseTab(raw: unknown, fallbackOrder: number): OpenConversationTab | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  if (!isKind(record.kind)) {
    return undefined;
  }
  const conversationId = typeof record.conversationId === "string" ? record.conversationId : undefined;
  const title = typeof record.title === "string" ? record.title : undefined;
  if (!conversationId || !title) {
    return undefined;
  }
  // main/collab 必须带所属项目（点它要 selectProject）；dm 的 projectId 是容器项目，可有可无。
  const projectId = typeof record.projectId === "string" ? record.projectId : undefined;
  if (record.kind !== "dm" && !projectId) {
    return undefined;
  }
  const lastActiveAt =
    typeof record.lastActiveAt === "number" && Number.isFinite(record.lastActiveAt)
      ? record.lastActiveAt
      : fallbackOrder;
  return {
    kind: record.kind,
    conversationId,
    ...(projectId !== undefined ? { projectId } : {}),
    title,
    unread: 0,
    lastActiveAt
  };
}

export function loadOpenConversationTabs(input: {
  storage: StorageLike | undefined;
  workspaceId: string;
  userId: string;
}): OpenConversationTab[] {
  const { storage, workspaceId, userId } = input;
  if (!storage) {
    return [];
  }
  let rawValue: string | null = null;
  try {
    rawValue = storage.getItem(openTabsStorageKey(workspaceId, userId));
  } catch {
    return [];
  }
  if (!rawValue) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const tabs: OpenConversationTab[] = [];
  const seen = new Set<string>();
  parsed.forEach((entry, order) => {
    const tab = parseTab(entry, order);
    if (!tab || seen.has(tab.conversationId)) {
      return;
    }
    seen.add(tab.conversationId);
    tabs.push(tab);
  });
  return tabs.slice(0, MAX_OPEN_CONVERSATION_TABS);
}

export function saveOpenConversationTabs(input: {
  storage: StorageLike | undefined;
  workspaceId: string;
  userId: string;
  tabs: readonly OpenConversationTab[];
}): void {
  const { storage, workspaceId, userId, tabs } = input;
  if (!storage) {
    return;
  }
  const key = openTabsStorageKey(workspaceId, userId);
  try {
    if (tabs.length === 0) {
      storage.removeItem(key);
      return;
    }
    const payload = JSON.stringify(
      tabs.map((tab) => ({
        kind: tab.kind,
        conversationId: tab.conversationId,
        ...(tab.projectId !== undefined ? { projectId: tab.projectId } : {}),
        title: tab.title,
        lastActiveAt: tab.lastActiveAt
      }))
    );
    storage.setItem(key, payload);
  } catch {
    // 配额满/隐私模式：静默降级为「这次没存上」，不打断用户。
  }
}
