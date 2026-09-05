// WorkHub 桌面 · Spotlight「Cuu 的记忆」能力内联视图（R14 批 MEM，独立能力，不是 settings.ts 内联区块——
// 见 03-mem-design.md §6.2：管理面是 list→detail→edit 多层交互，硬塞进 settings 的 innerHTML 全量重绘
// 扁平区块会让状态机复杂到失控，照 drive.ts/proposals.ts 的既有「独立能力视图」先例另起一个）。
//
// 两个 tab：「关于我」= 用户记忆（本人可读写，GET/PATCH/DELETE /api/me/memories），
// 「团队技能」= 全员可读、编辑与停用仅管理员（GET/PATCH /api/team-skills/manage + deactivate）。
// 端点/错误码见 r12-desktop-workbench/reports/r14-mem-server.md；VM/请求契约见
// packages/contracts/src/pages.ts 的 userMemoryManagement*/teamSkillManagement* 系列 schema。
//
// isAdmin 判定：这个视图自己在 mount 时调 ctx.client.me()（GET /api/auth/me，桌面既有的身份来源——
// browser.ts 启动时已经在用同一个方法做死 token 自愈判定）取 is_admin，不读 workspace_memberships.role
// （那是摆设字段，服务端 team-skill-governance 服务同款口径，见 03-mem-design §5）。
//
// 删除/停用的二次确认是「点一次武装 + 限时窗口内再点一次才真正执行」的两段式确认，写法照抄
// apps/desktop-webview/src/workbench/drive/side-panel.ts 的 decideRollbackConfirmation/armedRollbackTimer
// ——只借鉴这个纯逻辑写法，本文件不 import 也不改 workbench/** 任何文件（工包围栏禁区）。

import { WorkHubApiError } from "@workhub/api-client";
import type {
  PatchTeamSkillRequest,
  PatchUserMemoryRequest,
  SkillEditOp,
  TeamSkillManagementItemVM,
  TeamSkillManagementPageVM,
  TeamSkillStatus,
  UserMemoryCategory,
  UserMemoryManagementItemVM,
  UserMemoryManagementPageVM
} from "@workhub/contracts";
import { escapeHtml } from "@workhub/web-runtime";

import { spotlightErrorHtml, type SpotlightCapabilityView, type SpotlightViewContext } from "../view-context.js";

import { spotlightViewsT } from "./locales.js";

const MEMORIES_PATH = "/api/me/memories";
const TEAM_SKILLS_PATH = "/api/team-skills/manage";
// 两段式确认的武装窗口：第一次点只「武装」，这段时间内再点同一项才真正执行，否则自动复原
// （同 side-panel.ts 的 5 秒窗口）。
const ARMED_CONFIRM_MS = 5000;

type MemoryTab = "profile" | "skills";

// —— 纯格式化/渲染函数（可单测，无副作用）——

function formatMemoryTimestamp(iso: string, locale: "zh-CN" | "en-US"): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(iso));
}

export function categoryLabel(category: UserMemoryCategory, zh: boolean): string {
  const table: Record<UserMemoryCategory, [string, string]> = {
    preference: ["偏好", "Preference"],
    correction: ["纠正意见", "Correction"],
    recurring_context: ["常见场景", "Recurring context"]
  };
  const entry = table[category];
  return zh ? entry[0] : entry[1];
}

export function teamSkillStatusLabel(status: TeamSkillStatus, zh: boolean): string {
  const table: Record<TeamSkillStatus, [string, string]> = {
    draft: ["草稿", "Draft"],
    active: ["生效中", "Active"],
    deprecated: ["已停用", "Deprecated"]
  };
  const entry = table[status];
  return zh ? entry[0] : entry[1];
}

// 出处三级降级（03-mem-design §2.3）：服务端已经拼好人话 label（run join → proposal key 反解 →
// 诚实缺省），前端只在缺省时兜底「早期记录，出处不明」，不编造、不留空白。
export function memoryProvenanceLine(item: UserMemoryManagementItemVM, zh: boolean): string {
  return item.provenance?.label ?? (spotlightViewsT(zh, "anEarlyRecordTheSourceIs"));
}

// edited_at 非空时叠加一行——这是「学到什么」之外的另一件事（后来被人改过），不与出处合并成一句话。
export function memoryEditedLine(item: UserMemoryManagementItemVM, zh: boolean): string | undefined {
  if (!item.edited_at) {
    return undefined;
  }
  const when = formatMemoryTimestamp(item.edited_at, zh ? "zh-CN" : "en-US");
  return zh ? `最近由你于 ${when} 修改` : `You last edited this on ${when}`;
}

export function decideArmedConfirmation(armedId: string | undefined, id: string): "arm" | "execute" {
  return armedId === id ? "execute" : "arm";
}

const MEMORY_ERROR_MESSAGES: Record<string, [string, string]> = {
  user_memory_value_required: ["记忆内容不能为空。", "Content can't be empty."],
  user_memory_value_too_long: ["记忆内容太长，请精简后再保存。", "This is too long — trim it and try again."],
  user_memory_value_injection: [
    "内容包含可能干扰 AI 的指令式措辞，请改写后再保存。",
    "This looks like it's trying to instruct the AI — please rewrite it."
  ],
  user_memory_deleted: ["这条记忆已被删除，请刷新。", "This memory was already deleted — refresh and try again."],
  user_memory_version_conflict: [
    "这条记忆刚被更新，请刷新后再编辑。",
    "This memory changed elsewhere — refresh and try again."
  ],
  user_memory_not_found: ["没有找到这条记忆。", "Couldn't find this memory."],
  user_memory_access_denied: ["需要登录才能管理个人记忆。", "Sign in to manage your memories."]
};

const SKILL_ERROR_MESSAGES: Record<string, [string, string]> = {
  team_skill_admin_required: [
    "只有管理员可以编辑或停用团队技能。",
    "Only admins can edit or deactivate team skills."
  ],
  team_skill_not_found: ["没有找到这个团队技能。", "Couldn't find this team skill."],
  team_skill_not_editable: [
    "只能编辑当前生效的版本，这是一条历史版本。",
    "Only the active version can be edited — this is a past version."
  ],
  team_skill_base_version_conflict: [
    "这个技能已有更新版本，请刷新后重新编辑。",
    "This skill was updated elsewhere — refresh and try again."
  ],
  team_skill_edit_no_ops_applied: [
    "没找到这个段落，可能已被改过，请刷新后重试。",
    "That section couldn't be found — refresh and try again."
  ],
  team_skill_edit_no_effective_change: [
    "内容和现在一样，没有产生改动。",
    "That's identical to the current text — nothing to save."
  ],
  team_skill_edit_invalid_frontmatter: ["编辑后缺少必要信息，未通过校验。", "The edit is missing required fields."],
  team_skill_edit_too_short: ["内容太短，未通过校验。", "That's too short."],
  team_skill_edit_exceeds_size_budget: ["内容超过长度上限。", "That's too long."],
  team_skill_edit_conflict_markers: ["内容里有冲突标记，请清理后再试。", "Remove the conflict markers and try again."],
  team_skill_edit_injection_phrasing: [
    "内容包含可能干扰 AI 的指令式措辞，请改写后再保存。",
    "This looks like it's trying to instruct the AI — please rewrite it."
  ],
  team_skill_edit_low_confidence: ["没有通过置信度校验。", "This didn't pass the confidence check."]
};

// 服务端错误信息永远是中文硬编码字面量（无 i18n 分支），en-US 桌面客户端不能直接透传给用户——按
// error.code 查表给双语文案，未知 code 落一句通用兜底（同这个文件其余「诚实缺省」的取舍一致）。
function friendlyErrorMessage(error: unknown, zh: boolean, table: Record<string, [string, string]>): string {
  if (error instanceof WorkHubApiError) {
    const entry = table[error.code];
    if (entry) {
      return zh ? entry[0] : entry[1];
    }
  }
  return spotlightViewsT(zh, "somethingWentWrongTryAgain");
}

export function memoryErrorMessage(error: unknown, zh: boolean): string {
  return friendlyErrorMessage(error, zh, MEMORY_ERROR_MESSAGES);
}

export function skillErrorMessage(error: unknown, zh: boolean): string {
  return friendlyErrorMessage(error, zh, SKILL_ERROR_MESSAGES);
}

// —— tab 切换头 ——

export function memoryTabsHtml(active: MemoryTab, zh: boolean): string {
  const tabs: { id: MemoryTab; label: string }[] = [
    { id: "profile", label: spotlightViewsT(zh, "aboutMe") },
    { id: "skills", label: spotlightViewsT(zh, "teamSkills2") }
  ];
  return `<div class="wh-spot-reasons-row" role="tablist" aria-label="${escapeHtml(spotlightViewsT(zh, "memorySections"))}">${tabs
    .map(
      (t) =>
        `<button type="button" class="wh-spot-reason ds-pressable" role="tab" aria-selected="${t.id === active}" data-mem-tab="${t.id}" data-sel="${t.id === active}">${escapeHtml(t.label)}</button>`
    )
    .join("")}</div>`;
}

// —— 「关于我」：用户记忆列表/详情/编辑 ——

function memoryRowHtml(item: UserMemoryManagementItemVM, zh: boolean): string {
  const excerpt = item.value_md.length > 88 ? `${item.value_md.slice(0, 88)}…` : item.value_md;
  return `<button type="button" class="wh-spot-row" data-mem-open="${escapeHtml(item.id)}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(excerpt)}<span class="wh-spot-row-tag">${escapeHtml(categoryLabel(item.category, zh))}</span></div>
      <div class="wh-spot-row-sub">${escapeHtml(memoryProvenanceLine(item, zh))}</div>
    </div>
  </button>`;
}

export function memoryListHtml(vm: UserMemoryManagementPageVM, zh: boolean): string {
  if (!vm.memories.length) {
    return `<div class="wh-spot-empty">
      <div class="wh-spot-empty-face">(=^･ω･^=)</div>
      <h3 class="wh-spot-empty-title">${spotlightViewsT(zh, "cuuHasnTLearnedAnythingYet")}</h3>
      <p class="wh-spot-empty-sub">${spotlightViewsT(zh, "asYouWorkTogetherCuuWill")}</p>
    </div>`;
  }
  return `<div class="wh-spot-dash">
    <p class="wh-spot-row-sub">${escapeHtml(zh ? `共 ${vm.totals.active} 条` : `${vm.totals.active} total`)}</p>
    <div class="wh-spot-list ds-stagger">${vm.memories.map((m) => memoryRowHtml(m, zh)).join("")}</div>
  </div>`;
}

export function memoryDetailHtml(
  item: UserMemoryManagementItemVM,
  zh: boolean,
  // editError?: string | undefined（非只 `?:string`）——mount() 传入的是一个 `string | undefined` 状态变量，
  // exactOptionalPropertyTypes 下 `key?: T`（省略即 undefined）和 `key?: T | undefined`（显式 undefined 也
  // 合法）是两回事，这里要后者才能直接传变量而不必额外拆 spread。
  opts: { editing?: boolean; editError?: string | undefined; armedDelete?: boolean; busy?: boolean } = {}
): string {
  const editedLine = memoryEditedLine(item, zh);
  const meta = `<p class="wh-spot-row-sub">${escapeHtml(memoryProvenanceLine(item, zh))}</p>${editedLine ? `<p class="wh-spot-row-sub">${escapeHtml(editedLine)}</p>` : ""}`;
  const busyAttr = opts.busy ? " disabled" : "";

  const body = opts.editing
    ? `<textarea class="wh-spot-freetext" data-mem-edit-text rows="6" maxlength="2000">${escapeHtml(item.value_md)}</textarea>
      ${opts.editError ? `<p class="wh-spot-row-sub" style="color:var(--ds-danger)">${escapeHtml(opts.editError)}</p>` : ""}
      <div class="wh-spot-card-actions">
        <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-mem-save${busyAttr}>${opts.busy ? (spotlightViewsT(zh, "saving")) : spotlightViewsT(zh, "save")}</button>
        <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-mem-cancel-edit${busyAttr}>${spotlightViewsT(zh, "cancel")}</button>
      </div>`
    : `<p class="wh-spot-card-desc">${escapeHtml(item.value_md)}</p>
      <div class="wh-spot-card-actions">
        <button type="button" class="wh-spot-act ds-pressable" data-mem-edit${busyAttr}>${spotlightViewsT(zh, "edit")}</button>
        <button type="button" class="wh-spot-act ${opts.armedDelete ? "wh-spot-act--danger" : "wh-spot-act--quiet"} ds-pressable" data-mem-delete="${escapeHtml(item.id)}"${busyAttr}>${
          opts.busy ? (spotlightViewsT(zh, "deleting")) : opts.armedDelete ? (spotlightViewsT(zh, "sureClickAgain")) : spotlightViewsT(zh, "delete")
        }</button>
      </div>
      ${opts.armedDelete ? `<p class="wh-spot-bubble-note">${spotlightViewsT(zh, "deleteThisCuuWillForgetIt")}</p>` : ""}`;

  return `<div class="wh-spot-dash ds-anim-fade-in">
    <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-mem-back style="align-self:flex-start">${spotlightViewsT(zh, "back")}</button>
    <div>
      <span class="wh-spot-row-tag">${escapeHtml(categoryLabel(item.category, zh))}</span>
      ${meta}
    </div>
    ${body}
  </div>`;
}

// —— 「团队技能」：列表/详情/K2 段落级编辑 ——

function teamSkillRowHtml(item: TeamSkillManagementItemVM, zh: boolean): string {
  const tag = item.status !== "active" ? `<span class="wh-spot-row-tag">${escapeHtml(teamSkillStatusLabel(item.status, zh))}</span>` : "";
  return `<button type="button" class="wh-spot-row" data-skill-open="${escapeHtml(item.id)}">
    <div class="wh-spot-row-main">
      <div class="wh-spot-row-title">${escapeHtml(item.name)}${tag}</div>
      <div class="wh-spot-row-sub">${escapeHtml(item.when_to_use)}</div>
    </div>
  </button>`;
}

export function teamSkillListHtml(vm: TeamSkillManagementPageVM, zh: boolean, isAdmin: boolean): string {
  if (!vm.skills.length) {
    return `<div class="wh-spot-empty">
      <div class="wh-spot-empty-face">(=･ｪ･=)</div>
      <h3 class="wh-spot-empty-title">${spotlightViewsT(zh, "noTeamSkillsYet")}</h3>
      <p class="wh-spot-empty-sub">${spotlightViewsT(zh, "asCuuFinishesMoreWorkIt")}</p>
    </div>`;
  }
  const adminNote = isAdmin
    ? ""
    : `<p class="wh-spot-row-sub">${spotlightViewsT(zh, "onlyAdminsCanEditOrDeactivate")}</p>`;
  return `<div class="wh-spot-dash">${adminNote}<div class="wh-spot-list ds-stagger">${vm.skills.map((s) => teamSkillRowHtml(s, zh)).join("")}</div></div>`;
}

function skillMetricsHtml(item: TeamSkillManagementItemVM, zh: boolean): string {
  const confidence = item.confidence_score !== undefined ? `${Math.round(item.confidence_score * 100)}%` : "—";
  const provenanceLine = item.provenance
    ? zh
      ? `从 v${item.provenance.refined_from_version} 精修 · ${item.provenance.op_count} 处改动`
      : `Refined from v${item.provenance.refined_from_version} · ${item.provenance.op_count} change(s)`
    : item.created_by_kind === "human"
      ? spotlightViewsT(zh, "authoredByAHuman")
      : spotlightViewsT(zh, "distilledByAi");
  return `<div class="wh-spot-metrics">
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "version")}</span><span class="wh-spot-metric-v">v${item.version}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "samples")}</span><span class="wh-spot-metric-v">${item.sample_count}</span></div>
    <div class="wh-spot-metric"><span class="wh-spot-metric-k">${spotlightViewsT(zh, "confidence")}</span><span class="wh-spot-metric-v">${confidence}</span></div>
  </div>
  <p class="wh-spot-row-sub">${escapeHtml(provenanceLine)}</p>`;
}

// K2 精修假设结构化的「## 标题」分节正文——服务端 skill-curation.ts 的解析器不导出（在本工包围栏外），
// 这里独立写一份轻量客户端解析，只用于「选段」UI 的分节展示；真正的校验/应用权威地留在服务端
// validateSkillEditPatch（逐字复用，见 03-mem-design §3.2），客户端解析出错不会绕过服务端闸门。
export function parseSkillSections(contentMd: string): { title: string; body: string }[] {
  const lines = contentMd.split(/\r?\n/u);
  const sections: { title: string; body: string }[] = [];
  let current: { title: string; body: string[] } | undefined;
  for (const line of lines) {
    const heading = /^##\s+(.+)$/u.exec(line);
    if (heading?.[1]) {
      if (current) {
        sections.push({ title: current.title, body: current.body.join("\n").trim() });
      }
      current = { title: heading[1].trim(), body: [] };
      continue;
    }
    if (current) {
      current.body.push(line);
    }
  }
  if (current) {
    sections.push({ title: current.title, body: current.body.join("\n").trim() });
  }
  return sections;
}

const NEW_SECTION_SENTINEL = "__new__";

export function teamSkillDetailHtml(
  item: TeamSkillManagementItemVM,
  zh: boolean,
  // 同 memoryDetailHtml：editError/selectedSection 显式允许 `| undefined`（exactOptionalPropertyTypes）。
  opts: {
    isAdmin: boolean;
    editing?: boolean;
    editError?: string | undefined;
    armedDeactivate?: boolean;
    busy?: boolean;
    sections: { title: string; body: string }[];
    selectedSection?: string | undefined;
  }
): string {
  const statusTone = item.status === "deprecated" ? "wh-spot-chip--handoff" : item.status === "draft" ? "wh-spot-chip--info" : "wh-spot-chip--permission";
  const deprecatedNote =
    item.status === "deprecated"
      ? `<p class="wh-spot-bubble-note">${escapeHtml(
          item.deprecated_reason ? (zh ? `已停用：${item.deprecated_reason}` : `Deactivated: ${item.deprecated_reason}`) : spotlightViewsT(zh, "deactivated")
        )}</p>`
      : "";
  const backBtn = `<button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-skill-back style="align-self:flex-start">${spotlightViewsT(zh, "back")}</button>`;
  const busyAttr = opts.busy ? " disabled" : "";

  if (opts.editing) {
    const isNew = opts.selectedSection === NEW_SECTION_SENTINEL || (opts.selectedSection === undefined && opts.sections.length === 0);
    const chips =
      opts.sections
        .map(
          (s) =>
            `<button type="button" class="wh-spot-reason ds-pressable" data-skill-section-chip="${escapeHtml(s.title)}" data-sel="${!isNew && opts.selectedSection === s.title}">${escapeHtml(s.title)}</button>`
        )
        .join("") +
      `<button type="button" class="wh-spot-reason ds-pressable" data-skill-section-new data-sel="${isNew}">${spotlightViewsT(zh, "newSection")}</button>`;
    const activeSectionBody = !isNew ? opts.sections.find((s) => s.title === opts.selectedSection)?.body ?? "" : "";
    const titleField = isNew
      ? `<input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-skill-new-section-title maxlength="80" placeholder="${escapeHtml(spotlightViewsT(zh, "newSectionTitleEGEdge"))}" />`
      : "";
    return `<div class="wh-spot-dash ds-anim-fade-in">
      ${backBtn}
      <div><h3 class="wh-spot-card-title">${escapeHtml(item.name)}</h3></div>
      <div class="wh-spot-set-group">
        <div class="wh-spot-set-label">${spotlightViewsT(zh, "pickASectionToEdit")}</div>
        <div class="wh-spot-reasons-row">${chips}</div>
      </div>
      ${titleField}
      <textarea class="wh-spot-freetext" data-skill-edit-text rows="6" maxlength="4000" placeholder="${escapeHtml(spotlightViewsT(zh, "sectionContent"))}">${escapeHtml(activeSectionBody)}</textarea>
      <input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-skill-rationale maxlength="500" placeholder="${escapeHtml(spotlightViewsT(zh, "optionalWhyYouReMakingThis"))}" />
      ${opts.editError ? `<p class="wh-spot-row-sub" style="color:var(--ds-danger)">${escapeHtml(opts.editError)}</p>` : ""}
      <div class="wh-spot-card-actions">
        <button type="button" class="wh-spot-act wh-spot-act--primary ds-pressable" data-skill-save${busyAttr}>${opts.busy ? (spotlightViewsT(zh, "saving")) : spotlightViewsT(zh, "save")}</button>
        <button type="button" class="wh-spot-act wh-spot-act--quiet ds-pressable" data-skill-cancel-edit${busyAttr}>${spotlightViewsT(zh, "cancel")}</button>
      </div>
    </div>`;
  }

  const actions =
    opts.isAdmin && item.status === "active"
      ? `<div class="wh-spot-card-actions">
        <button type="button" class="wh-spot-act ds-pressable" data-skill-edit${busyAttr}>${spotlightViewsT(zh, "edit")}</button>
        <button type="button" class="wh-spot-act ${opts.armedDeactivate ? "wh-spot-act--danger" : "wh-spot-act--quiet"} ds-pressable" data-skill-deactivate="${escapeHtml(item.id)}"${busyAttr}>${
          opts.busy ? (spotlightViewsT(zh, "working")) : opts.armedDeactivate ? (spotlightViewsT(zh, "sureClickAgain2")) : spotlightViewsT(zh, "deactivate")
        }</button>
      </div>
      ${
        opts.armedDeactivate
          ? `<input type="text" class="wh-spot-freetext wh-spot-freetext--line" data-skill-deactivate-reason maxlength="500" placeholder="${escapeHtml(spotlightViewsT(zh, "optionalReasonForDeactivating"))}" />
      <p class="wh-spot-bubble-note">${spotlightViewsT(zh, "onceDeactivatedAiStopsUsingThis")}</p>`
          : ""
      }`
      : "";

  return `<div class="wh-spot-dash ds-anim-fade-in">
    ${backBtn}
    <div>
      <div class="wh-spot-card-head"><span class="wh-spot-chip ${statusTone}">${escapeHtml(teamSkillStatusLabel(item.status, zh))}</span></div>
      <h3 class="wh-spot-card-title" style="margin-top:10px">${escapeHtml(item.name)}</h3>
      <p class="wh-spot-card-desc">${escapeHtml(item.when_to_use)}</p>
    </div>
    ${skillMetricsHtml(item, zh)}
    ${deprecatedNote}
    <pre class="wh-spot-row-sub wh-spot-drive-preview-text">${escapeHtml(item.content_md)}</pre>
    ${actions}
  </div>`;
}

// —— mount：list→detail 全在盒子内联 morph，照 drive.ts/proposals.ts 既有分工（纯渲染函数在上面，
// 挂载/事件绑定在这里）——

export function createMemoryView(): SpotlightCapabilityView {
  return {
    id: "memory",
    mount(ctx: SpotlightViewContext) {
      const zh = ctx.locale === "zh-CN";
      const { client, body } = ctx;
      let disposed = false;
      let busy = false;
      let tab: MemoryTab = "profile";
      let isAdmin = false;
      let retry: (() => void) | undefined;
      // rank9 同款：单调代次，切 tab/重载时晚到的 await 不得覆盖新一帧。
      let loadGen = 0;

      let memoriesVm: UserMemoryManagementPageVM | undefined;
      let selectedMemory: UserMemoryManagementItemVM | undefined;
      let memoryEditing = false;
      let memoryEditError: string | undefined;
      let armedDeleteId: string | undefined;
      let armedDeleteTimer: ReturnType<typeof setTimeout> | undefined;

      let skillsVm: TeamSkillManagementPageVM | undefined;
      let selectedSkill: TeamSkillManagementItemVM | undefined;
      let skillEditing = false;
      let skillEditError: string | undefined;
      let skillSelectedSection: string | undefined;
      let armedDeactivateId: string | undefined;
      let armedDeactivateTimer: ReturnType<typeof setTimeout> | undefined;

      const clearArmedDelete = () => {
        if (armedDeleteTimer !== undefined) {
          clearTimeout(armedDeleteTimer);
          armedDeleteTimer = undefined;
        }
        armedDeleteId = undefined;
      };
      const clearArmedDeactivate = () => {
        if (armedDeactivateTimer !== undefined) {
          clearTimeout(armedDeactivateTimer);
          armedDeactivateTimer = undefined;
        }
        armedDeactivateId = undefined;
      };

      const setSubtitleForTab = () => {
        ctx.setSubtitle(tab === "profile" ? (spotlightViewsT(ctx.locale, "aboutMe")) : spotlightViewsT(ctx.locale, "teamSkills2"));
      };

      const wrapWithTabs = (innerHtml: string) => `<div class="wh-spot-dash">${memoryTabsHtml(tab, zh)}${innerHtml}</div>`;

      const renderProfile = () => {
        if (!memoriesVm) {
          return;
        }
        body.innerHTML = wrapWithTabs(
          selectedMemory
            ? memoryDetailHtml(selectedMemory, zh, { editing: memoryEditing, editError: memoryEditError, armedDelete: armedDeleteId === selectedMemory.id, busy })
            : memoryListHtml(memoriesVm, zh)
        );
        ctx.requestResize();
        ctx.refocusBody();
      };

      const renderSkills = () => {
        if (!skillsVm) {
          return;
        }
        body.innerHTML = wrapWithTabs(
          selectedSkill
            ? teamSkillDetailHtml(selectedSkill, zh, {
                isAdmin,
                editing: skillEditing,
                editError: skillEditError,
                armedDeactivate: armedDeactivateId === selectedSkill.id,
                busy,
                sections: parseSkillSections(selectedSkill.content_md),
                selectedSection: skillSelectedSection
              })
            : teamSkillListHtml(skillsVm, zh, isAdmin)
        );
        ctx.requestResize();
        ctx.refocusBody();
      };

      const loadMemories = async () => {
        const gen = ++loadGen;
        memoriesVm = undefined;
        selectedMemory = undefined;
        memoryEditing = false;
        memoryEditError = undefined;
        clearArmedDelete();
        body.innerHTML = wrapWithTabs(`<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingMemories")}</div>`);
        ctx.requestResize();
        try {
          const data = await client.request<UserMemoryManagementPageVM>(MEMORIES_PATH);
          if (disposed || gen !== loadGen) return;
          memoriesVm = data;
          renderProfile();
        } catch {
          if (disposed || gen !== loadGen) return;
          retry = () => void loadMemories();
          body.innerHTML = wrapWithTabs(spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadMemories")));
          ctx.requestResize();
        }
      };

      const loadSkills = async () => {
        const gen = ++loadGen;
        skillsVm = undefined;
        selectedSkill = undefined;
        skillEditing = false;
        skillEditError = undefined;
        clearArmedDeactivate();
        body.innerHTML = wrapWithTabs(`<div class="wh-spot-loading"><span class="wh-spot-spinner"></span>${spotlightViewsT(ctx.locale, "loadingTeamSkills")}</div>`);
        ctx.requestResize();
        try {
          const data = await client.request<TeamSkillManagementPageVM>(TEAM_SKILLS_PATH);
          if (disposed || gen !== loadGen) return;
          skillsVm = data;
          renderSkills();
        } catch {
          if (disposed || gen !== loadGen) return;
          retry = () => void loadSkills();
          body.innerHTML = wrapWithTabs(spotlightErrorHtml(zh, spotlightViewsT(ctx.locale, "couldnTLoadTeamSkills")));
          ctx.requestResize();
        }
      };

      const saveMemoryEdit = async (item: UserMemoryManagementItemVM, valueMd: string) => {
        const trimmed = valueMd.trim();
        if (!trimmed) {
          memoryEditError = spotlightViewsT(ctx.locale, "contentCanTBeEmpty");
          renderProfile();
          return;
        }
        busy = true;
        memoryEditError = undefined;
        renderProfile();
        try {
          const payload: PatchUserMemoryRequest = { value_md: trimmed, expected_updated_at: item.updated_at };
          const updated = await client.request<UserMemoryManagementItemVM>(`${MEMORIES_PATH}/${encodeURIComponent(item.id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
          if (disposed) return;
          busy = false;
          selectedMemory = updated;
          memoryEditing = false;
          memoriesVm = undefined; // 失效缓存列表——返回列表时重新拉，拿到新鲜的 totals/内容
          ctx.toast(spotlightViewsT(ctx.locale, "saved"), "ok");
          ctx.onActionSettled?.();
          renderProfile();
        } catch (error) {
          if (disposed) return;
          busy = false;
          memoryEditError = memoryErrorMessage(error, zh);
          renderProfile();
        }
      };

      const deleteMemory = async (id: string) => {
        busy = true;
        renderProfile();
        try {
          await client.request<{ deleted: true }>(`${MEMORIES_PATH}/${encodeURIComponent(id)}`, { method: "DELETE" });
          if (disposed) return;
          busy = false;
          ctx.toast(spotlightViewsT(ctx.locale, "deletedCuuWillForgetIt"), "ok");
          ctx.onActionSettled?.();
          void loadMemories();
        } catch (error) {
          if (disposed) return;
          busy = false;
          ctx.toast(memoryErrorMessage(error, zh), "error");
          renderProfile();
        }
      };

      const saveSkillEdit = async () => {
        if (!selectedSkill) return;
        const textEl = body.querySelector<HTMLTextAreaElement>("[data-skill-edit-text]");
        const contentMd = textEl?.value.trim() ?? "";
        const sections = parseSkillSections(selectedSkill.content_md);
        const isNew = skillSelectedSection === NEW_SECTION_SENTINEL || (skillSelectedSection === undefined && sections.length === 0);
        let op: SkillEditOp;
        if (isNew) {
          const titleEl = body.querySelector<HTMLInputElement>("[data-skill-new-section-title]");
          const title = titleEl?.value.trim() ?? "";
          if (!title) {
            skillEditError = spotlightViewsT(ctx.locale, "enterATitleForTheNew");
            renderSkills();
            return;
          }
          if (!contentMd) {
            skillEditError = spotlightViewsT(ctx.locale, "enterTheSectionContent");
            renderSkills();
            return;
          }
          op = { op: "add_section", section: title, content_md: contentMd };
        } else {
          if (!contentMd) {
            skillEditError = spotlightViewsT(ctx.locale, "contentCanTBeEmpty2");
            renderSkills();
            return;
          }
          op = { op: "modify_section", section: skillSelectedSection as string, content_md: contentMd };
        }
        const rationaleEl = body.querySelector<HTMLInputElement>("[data-skill-rationale]");
        const rationale = rationaleEl?.value.trim();
        busy = true;
        skillEditError = undefined;
        renderSkills();
        try {
          const payload: PatchTeamSkillRequest = {
            ops: [op],
            base_version: selectedSkill.version,
            ...(rationale ? { rationale_md: rationale } : {})
          };
          const updated = await client.request<TeamSkillManagementItemVM>(`${TEAM_SKILLS_PATH}/${encodeURIComponent(selectedSkill.id)}`, {
            method: "PATCH",
            body: JSON.stringify(payload)
          });
          if (disposed) return;
          busy = false;
          selectedSkill = updated;
          skillEditing = false;
          skillSelectedSection = undefined;
          skillsVm = undefined; // 失效缓存——promote() 会生成新行+把旧行标 deprecated，返回列表时重新拉
          ctx.toast(spotlightViewsT(ctx.locale, "savedANewVersion"), "ok");
          ctx.onActionSettled?.();
          renderSkills();
        } catch (error) {
          if (disposed) return;
          busy = false;
          skillEditError = skillErrorMessage(error, zh);
          renderSkills();
        }
      };

      const deactivateSkill = async (id: string, reason: string | undefined) => {
        busy = true;
        renderSkills();
        try {
          await client.request<{ deprecated: true }>(`${TEAM_SKILLS_PATH}/${encodeURIComponent(id)}/deactivate`, {
            method: "POST",
            ...(reason ? { body: JSON.stringify({ reason }) } : {})
          });
          if (disposed) return;
          busy = false;
          ctx.toast(spotlightViewsT(ctx.locale, "deactivated"), "ok");
          ctx.onActionSettled?.();
          void loadSkills();
        } catch (error) {
          if (disposed) return;
          busy = false;
          ctx.toast(skillErrorMessage(error, zh), "error");
          renderSkills();
        }
      };

      const switchTab = (next: MemoryTab) => {
        if (next === tab) return;
        tab = next;
        setSubtitleForTab();
        if (tab === "profile") {
          if (memoriesVm) renderProfile();
          else void loadMemories();
        } else {
          if (skillsVm) renderSkills();
          else void loadSkills();
        }
      };

      body.addEventListener(
        "click",
        (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;

          if (target.closest("[data-spot-retry]")) {
            retry?.();
            return;
          }

          const tabBtn = target.closest<HTMLElement>("[data-mem-tab]");
          if (tabBtn?.dataset.memTab) {
            switchTab(tabBtn.dataset.memTab as MemoryTab);
            return;
          }

          // —— 关于我 ——
          const openMem = target.closest<HTMLElement>("[data-mem-open]");
          if (openMem?.dataset.memOpen && memoriesVm) {
            selectedMemory = memoriesVm.memories.find((m) => m.id === openMem.dataset.memOpen);
            memoryEditing = false;
            memoryEditError = undefined;
            clearArmedDelete();
            renderProfile();
            return;
          }
          if (target.closest("[data-mem-back]")) {
            selectedMemory = undefined;
            memoryEditing = false;
            memoryEditError = undefined;
            clearArmedDelete();
            renderProfile();
            return;
          }
          if (target.closest("[data-mem-edit]")) {
            if (busy) return;
            memoryEditing = true;
            memoryEditError = undefined;
            renderProfile();
            return;
          }
          if (target.closest("[data-mem-cancel-edit]")) {
            memoryEditing = false;
            memoryEditError = undefined;
            renderProfile();
            return;
          }
          if (target.closest("[data-mem-save]")) {
            if (busy || !selectedMemory) return;
            const textarea = body.querySelector<HTMLTextAreaElement>("[data-mem-edit-text]");
            void saveMemoryEdit(selectedMemory, textarea?.value ?? "");
            return;
          }
          const delBtn = target.closest<HTMLElement>("[data-mem-delete]");
          if (delBtn?.dataset.memDelete && selectedMemory && !busy) {
            const id = delBtn.dataset.memDelete;
            if (decideArmedConfirmation(armedDeleteId, id) === "arm") {
              armedDeleteId = id;
              if (armedDeleteTimer !== undefined) clearTimeout(armedDeleteTimer);
              armedDeleteTimer = setTimeout(() => {
                armedDeleteTimer = undefined;
                if (disposed || armedDeleteId !== id) return;
                armedDeleteId = undefined;
                renderProfile();
              }, ARMED_CONFIRM_MS);
              renderProfile();
              return;
            }
            clearArmedDelete();
            void deleteMemory(id);
            return;
          }

          // —— 团队技能 ——
          const openSkill = target.closest<HTMLElement>("[data-skill-open]");
          if (openSkill?.dataset.skillOpen && skillsVm) {
            selectedSkill = skillsVm.skills.find((s) => s.id === openSkill.dataset.skillOpen);
            skillEditing = false;
            skillEditError = undefined;
            skillSelectedSection = undefined;
            clearArmedDeactivate();
            renderSkills();
            return;
          }
          if (target.closest("[data-skill-back]")) {
            selectedSkill = undefined;
            skillEditing = false;
            skillEditError = undefined;
            clearArmedDeactivate();
            renderSkills();
            return;
          }
          if (target.closest("[data-skill-edit]")) {
            if (busy || !isAdmin || !selectedSkill) return;
            skillEditing = true;
            skillEditError = undefined;
            skillSelectedSection = parseSkillSections(selectedSkill.content_md)[0]?.title;
            renderSkills();
            return;
          }
          if (target.closest("[data-skill-cancel-edit]")) {
            skillEditing = false;
            skillEditError = undefined;
            renderSkills();
            return;
          }
          const sectionChip = target.closest<HTMLElement>("[data-skill-section-chip]");
          if (sectionChip && sectionChip.dataset.skillSectionChip !== undefined) {
            skillSelectedSection = sectionChip.dataset.skillSectionChip;
            renderSkills();
            return;
          }
          if (target.closest("[data-skill-section-new]")) {
            skillSelectedSection = NEW_SECTION_SENTINEL;
            renderSkills();
            return;
          }
          if (target.closest("[data-skill-save]")) {
            if (busy || !selectedSkill) return;
            void saveSkillEdit();
            return;
          }
          const deactivateBtn = target.closest<HTMLElement>("[data-skill-deactivate]");
          if (deactivateBtn?.dataset.skillDeactivate && selectedSkill && !busy) {
            const id = deactivateBtn.dataset.skillDeactivate;
            if (decideArmedConfirmation(armedDeactivateId, id) === "arm") {
              armedDeactivateId = id;
              if (armedDeactivateTimer !== undefined) clearTimeout(armedDeactivateTimer);
              armedDeactivateTimer = setTimeout(() => {
                armedDeactivateTimer = undefined;
                if (disposed || armedDeactivateId !== id) return;
                armedDeactivateId = undefined;
                renderSkills();
              }, ARMED_CONFIRM_MS);
              renderSkills();
              return;
            }
            clearArmedDeactivate();
            const reasonInput = body.querySelector<HTMLInputElement>("[data-skill-deactivate-reason]");
            void deactivateSkill(id, reasonInput?.value.trim() || undefined);
          }
        },
        { signal: ctx.signal }
      );

      setSubtitleForTab();
      void loadMemories();
      // 身份判定与列表加载并行，不互相阻塞；is_admin 就绪较晚且用户已切到团队技能 tab 时补一次重渲，
      // 否则编辑/停用按钮要等下一次交互才会出现。
      void client
        .me()
        .then((me) => {
          if (disposed) return;
          isAdmin = me?.is_admin === true;
          if (tab === "skills" && skillsVm) {
            renderSkills();
          }
        })
        .catch(() => {
          isAdmin = false;
        });

      return () => {
        disposed = true;
        clearArmedDelete();
        clearArmedDeactivate();
      };
    }
  };
}
