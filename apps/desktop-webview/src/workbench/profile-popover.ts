// WorkHub 桌面 · R15 批 B（人对人私聊 · B4 点头像开聊）：统一的轻量资料卡（popover）。
// 全应用任何带 data-wb-avatar-user-id 的头像（聊天气泡 / 会话头成员条 / rail 成员 roster 行），点击都
// 弹同一张资料卡：对方昵称 + 在线态 +「发私聊」；对自己不显示「发私聊」（显示「这是你」）。
//
// 边界：建群选人器行（.wh-wb-new-collab-member-row）里的头像**不**走这张卡——那里的点击语义是勾选成员，
// 保持不动（见 render* 顶部注释与 04 §B4）。所以委托里显式跳过这类祖先。
//
// 纯逻辑（resolveProfileFromState / shouldOpenProfileFor）单测；DOM 定位/开关是 best-effort 的命令式接线
// （这个 workspace 的测试运行器没有真实 DOM，见 chat/view.test.ts 顶部注释）。

import { escapeHtml } from "@workhub/web-runtime";

import { avatarTileHtml } from "./chat/render.js";
import type { WorkbenchStore, WorkbenchStoreState } from "./store.js";

import { workbenchT } from "./locales.js";

type Locale = "zh-CN" | "en-US";

export type ProfileCardData = {
  userId: string;
  nickname: string;
  online: boolean;
  isSelf: boolean;
};

// 从 store 现状把一个 user id 解析成资料卡数据。昵称来源：先工作台 VM 的 workspace_members（工作区级、
// cap 100），再 DM 列表参与者（对方昵称从这里来，即便还没选任何项目）。两处都查不到 → undefined（解析
// 不出昵称就不弹卡，不摆一张「未知成员」的空卡）。在线两态取 store.onlineUserIds（rail 轮询写入）。
export function resolveProfileFromState(
  state: Pick<WorkbenchStoreState, "vm" | "dmList" | "onlineUserIds" | "currentUserId">,
  userId: string
): ProfileCardData | undefined {
  if (!userId) {
    return undefined;
  }
  const fromMembers = state.vm?.workspace_members.items.find((member) => member.user_id === userId);
  let nickname = fromMembers?.nickname;
  if (!nickname) {
    for (const dm of state.dmList) {
      const participant = dm.participants.find((entry) => entry.user_id === userId);
      if (participant) {
        nickname = participant.nickname;
        break;
      }
    }
  }
  if (!nickname) {
    return undefined;
  }
  const online = state.onlineUserIds.includes(userId);
  // isSelf：优先 currentUserId；没有它时退回 VM 的 is_self / DM 的 is_self 参与者标记。
  let isSelf = state.currentUserId ? userId === state.currentUserId : false;
  if (!state.currentUserId) {
    if (fromMembers?.is_self) {
      isSelf = true;
    } else {
      for (const dm of state.dmList) {
        const participant = dm.participants.find((entry) => entry.user_id === userId);
        if (participant?.is_self) {
          isSelf = true;
          break;
        }
      }
    }
  }
  return { userId, nickname, online, isSelf };
}

// 一次点击是否应弹资料卡：命中头像 / roster 行的 profile 钩子，且不在建群选人器行内。返回目标 user id。
export function profileTargetFor(target: Element): string | undefined {
  if (target.closest(".wh-wb-new-collab-member-row")) {
    return undefined;
  }
  const rosterRow = target.closest<HTMLElement>("[data-wb-open-profile]");
  if (rosterRow?.dataset.wbOpenProfile) {
    return rosterRow.dataset.wbOpenProfile;
  }
  const avatar = target.closest<HTMLElement>("[data-wb-avatar-user-id]");
  const userId = avatar?.dataset.wbAvatarUserId;
  // Cuu 的猫头像不带 data-wb-avatar-user-id（见 avatarTileHtml 的 variant="cuu" 分支），天然不命中。
  return userId && userId.length > 0 ? userId : undefined;
}

export function renderProfilePopoverHtml(input: { data: ProfileCardData; locale: Locale }): string {
  const zh = input.locale === "zh-CN";
  const { data } = input;
  const statusText = data.online ? (workbenchT(input.locale, "online")) : workbenchT(input.locale, "offline");
  const statusClass = data.online ? "wh-wb-profile-status wh-wb-profile-status--online" : "wh-wb-profile-status";
  const avatar = avatarTileHtml({ label: data.nickname, id: data.userId, ...(data.online ? { online: true } : {}) });
  const action = data.isSelf
    ? `<div class="wh-wb-profile-self">${workbenchT(input.locale, "thisIsYou")}</div>`
    : `<button type="button" class="wh-wb-profile-dm" data-wb-popover-dm="${escapeHtml(data.userId)}">${
        workbenchT(input.locale, "message")
      }</button>`;
  return `<div class="wh-wb-profile-card ds-glass-strong">
    <div class="wh-wb-profile-head">
      <span class="wh-wb-profile-avatar">${avatar}</span>
      <div class="wh-wb-profile-meta">
        <div class="wh-wb-profile-name">${escapeHtml(data.nickname)}</div>
        <div class="${statusClass}">${statusText}</div>
      </div>
    </div>
    ${action}
  </div>`;
}

export type ProfilePopoverHandle = {
  close: () => void;
  dispose: () => void;
};

// root：工作台外壳根（事件委托挂这里，覆盖 rail/中栏所有头像）。onOpenDm：点了「发私聊」——交给
// shell 去 POST /api/dm/open 并打开会话（见 shell.ts）。
export function mountProfilePopover(
  root: HTMLElement,
  input: {
    store: WorkbenchStore;
    locale: Locale;
    onOpenDm: (userId: string) => void;
  }
): ProfilePopoverHandle {
  const doc = root.ownerDocument ?? document;
  let popEl: HTMLElement | undefined;
  let disposed = false;

  const close = () => {
    if (popEl) {
      popEl.remove();
      popEl = undefined;
    }
  };

  const openFor = (userId: string, anchor: Element) => {
    const data = resolveProfileFromState(input.store.getState(), userId);
    if (!data) {
      return;
    }
    close();
    const el = doc.createElement("div");
    el.className = "wh-wb-profile-pop";
    el.setAttribute("data-wb-profile-pop", "true");
    el.innerHTML = renderProfilePopoverHtml({ data, locale: input.locale });
    root.appendChild(el);
    popEl = el;
    // 定位：贴着被点头像的下方左对齐；拿不到 getBoundingClientRect（合成/测试环境）就退回不定位（左上角），
    // 不为一个边角坐标崩掉整张卡。
    try {
      const rect = anchor.getBoundingClientRect();
      const rootRect = root.getBoundingClientRect();
      const top = rect.bottom - rootRect.top + 6;
      const left = Math.max(8, rect.left - rootRect.left);
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
    } catch {
      // ignore: 没有真实布局信息时不定位。
    }
  };

  const onClick = (event: Event) => {
    if (disposed || !(event.target instanceof Element)) {
      return;
    }
    const target = event.target;
    // 卡内「发私聊」——先处理，别被下面的「点在卡外→关闭」抢走。
    const dmBtn = target.closest<HTMLElement>("[data-wb-popover-dm]");
    if (dmBtn?.dataset.wbPopoverDm) {
      const userId = dmBtn.dataset.wbPopoverDm;
      close();
      input.onOpenDm(userId);
      return;
    }
    // 点在卡内的其它地方：不关闭（让卡保持打开）。
    if (popEl && target.closest("[data-wb-profile-pop]")) {
      return;
    }
    const userId = profileTargetFor(target);
    if (userId) {
      const anchor = target.closest<HTMLElement>("[data-wb-open-profile]") ?? target.closest<HTMLElement>("[data-wb-avatar-user-id]") ?? target;
      openFor(userId, anchor);
      return;
    }
    // 点在任何头像/卡之外——关闭已开的卡。
    close();
  };

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
    }
  };

  root.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKeydown);

  return {
    close,
    dispose: () => {
      disposed = true;
      close();
      root.removeEventListener("click", onClick);
      doc.removeEventListener("keydown", onKeydown);
    }
  };
}
