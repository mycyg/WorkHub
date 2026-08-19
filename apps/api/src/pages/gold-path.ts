import {
  createP05GoldPathFixture,
  p05GoldPathIds,
  validateP05GoldPathFixture
} from "@workhub/agent/fixtures";
import { goldPathSurfaceVmSchema, type GoldPathSurfaceVM, type WorkHubLocale } from "@workhub/contracts";
import { toCuuState } from "@workhub/events";
import { parseOutputContract } from "./output-contract.js";

export { p05GoldPathIds };

function productCopy(value: string) {
  return value
    .replace(/\bcuu\b/giu, "AI assistant")
    .replace(/客户周报/gu, "区域发布复盘包")
    .replace(/周报/gu, "复盘包")
    .replace(/weekly_report/giu, "regional_launch_review")
    .replace(/weekly-report/giu, "regional-launch-review")
    .replace(/weekly report/giu, "regional launch review")
    .replace(/weekly/giu, "regional");
}

function shouldPreserveStructuredString(key: string | undefined) {
  if (!key) {
    return false;
  }
  if (key === "source_id") {
    return false;
  }
  return key === "fixture_id" ||
    key === "id" ||
    key === "href" ||
    key === "ref" ||
    key === "type" ||
    key === "topic" ||
    key === "method" ||
    key === "status" ||
    key === "kind" ||
    key === "task" ||
    key === "model" ||
    key === "provider" ||
    key === "currency" ||
    key === "source_type" ||
    key === "target_kind" ||
    key === "target_key" ||
    key === "change_type" ||
    key === "cuu_state" ||
    key.endsWith("_id") ||
    key.endsWith("_ids") ||
    key.endsWith("_href") ||
    key.endsWith("_ref");
}

function productizeSurface<T>(value: T, key?: string): T {
  if (typeof value === "string") {
    if (shouldPreserveStructuredString(key)) {
      return value;
    }
    return productCopy(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => productizeSurface(item, key)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, item]) => [childKey, productizeSurface(item, childKey)])
    ) as T;
  }
  return value;
}

const generatedEnglishCopy = new Map<string, string>([
  ["这份复盘包模板先按哪个口径做？", "Which direction should this review template use first?"],
  ["我会用会议纪要和网盘数据起草，先选一个最接近的方向。", "I will draft from meeting notes and drive data. Choose the closest direction first."],
  ["风险优先", "Risk first"],
  ["先列阻塞客户和需要你拍板的事项。", "List blocked customers and items needing your decision first."],
  ["更适合发给管理者快速看重点。", "Better for managers who need the key points quickly."],
  ["进展优先", "Progress first"],
  ["先列本周完成、下周计划，再补风险。", "List this week's progress and next week's plan before risks."],
  ["更适合团队日常同步。", "Better for routine team sync."],
  ["数据优先", "Data first"],
  ["先放核心指标和趋势，再补文字说明。", "Show core metrics and trends before narrative notes."],
  ["更适合经营复盘，但需要更多数据校验。", "Better for operating reviews, with more data validation needed."],
  ["有特殊格式再补一句，不填也可以。", "Add format requirements only if needed."],
  ["需求", "Intent"],
  ["口径", "Scope"],
  ["草稿", "Draft"],
  ["审批", "Approval"],
  ["我找到了会议口径、网盘数据和客户格式偏好，足够起草第一版。", "I found meeting criteria, drive data, and format preferences, enough for a first draft."],
  ["用这些证据继续", "Use this evidence"],
  ["打开完整检索", "Open full search"],
  ["再问一个范围问题", "Ask another scope question"],
  ["本次运行已接近单次预算上限，我会保留回放并优先使用便宜模型继续。", "This run is close to its per-run budget. Keep replay and prefer a cheaper model next."],
  ["继续但降级模型", "Continue with a cheaper model"],
  ["查看预算", "View budget"],
  ["生成区域发布复盘包模板", "Generate regional launch review template"],
  ["我的今日 AI 预算", "My AI budget today"],
  ["团队今日 AI 预算", "Team AI budget today"],
  ["写入交付物前后均有快照", "Snapshots exist before and after deliverable writes"],
  ["Proposal 打开已进入审计", "Proposal opening is audited"],
  ["查看变更", "View change"],
  ["打回", "Request changes"],
  ["区域发布复盘包模板已采纳", "Regional launch review template accepted"],
  ["我已经合并交付物，并留下了审计和回滚入口。", "I merged the deliverables and kept audit and rollback entry points."],
  ["查看交付物", "View deliverables"],
  ["查看回放", "View replay"],
  ["AI assistant 等你审批区域发布复盘包模板", "AI assistant is waiting for your review of the regional launch review template"],
  ["2 个交付物、3 条证据、可回滚；点同意后才会进入正式交付。", "2 deliverables, 3 evidence refs, reversible. It enters official delivery only after approval."],
  ["打回必须写原因，AI assistant 会把原因放进下一轮修改上下文。", "A rejection needs a reason; AI assistant will use it in the next revision context."],
  ["打开审批", "Open approval"],
  ["通过", "Approve"],
  ["AI assistant 写好了区域发布复盘包模板", "AI assistant drafted the regional launch review template"],
  ["请看一下这份非代码变更申请：2 个交付物、3 条证据、可回滚。", "Review this non-code change request: 2 deliverables, 3 evidence refs, reversible."],
  ["需要你决定采纳还是打回。", "Decide whether to accept it or request changes."],
  ["选择口径", "Choose scope"],
  ["区域发布复盘包模板", "Regional launch review template"],
  ["交付物已生成，等待审批。", "Deliverables are generated and waiting for approval."],
  ["先点一个复盘包口径，我再开始做。", "Choose a review direction before I start."],
  ["先点一个区域发布复盘包口径，我再开始做。", "Choose a regional launch review direction before I start."],
  ["采纳", "Approve"],
  ["打回并说明原因", "Request changes with a reason"],
  ["采纳进正式版", "Adopt into the official version"],
  ["澄清以点选为主", "Clarification is done by picking options"],
  ["交付物变更必须逐条可审", "Deliverable changes must be reviewable item by item"],
  ["回放页脚必须显示成本明细", "The replay footer must show cost details"]
]);

function localizeGeneratedSurface<T>(value: T, locale: WorkHubLocale, key?: string): T {
  if (locale !== "en-US") {
    return value;
  }
  if (typeof value === "string") {
    if (shouldPreserveStructuredString(key)) {
      return value;
    }
    return (generatedEnglishCopy.get(value) ?? value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => localizeGeneratedSurface(item, locale, key)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, item]) => [childKey, localizeGeneratedSurface(item, locale, childKey)])
    ) as T;
  }
  return value;
}

export function buildP05GoldPathSurfacePage(locale: WorkHubLocale = "zh-CN"): GoldPathSurfaceVM {
  const fixture = validateP05GoldPathFixture(createP05GoldPathFixture());
  const surface: GoldPathSurfaceVM = {
    fixture_id: fixture.id,
    routes: {
      home: "/",
      intake: `/intake/${p05GoldPathIds.session}`,
      approvals: "/approvals",
      workitem: `/workitems/${p05GoldPathIds.workItem}`,
      proposal: `/proposals/${p05GoldPathIds.proposal}`,
      replay: `/agent-runs/${p05GoldPathIds.run}/replay`,
      cost: "/dashboard/cost",
      knowledge: "/knowledge/search"
    },
    page_vms: {
      attention: fixture.attentionHome,
      question: fixture.question,
      evidence: fixture.evidenceBubble,
      approvals: fixture.approvalCenter,
      workitem: fixture.workItemDetail,
      proposal: fixture.proposalDetail,
      replay: fixture.replay,
      cost: fixture.costDashboard
    },
    events: fixture.events,
    cuu_states: fixture.events.map((event) => toCuuState(event))
  };

  return parseOutputContract(
    goldPathSurfaceVmSchema,
    localizeGeneratedSurface(productizeSurface(surface), locale),
    "gold-path.surface"
  );
}

export function getP05GoldPathFixture() {
  return validateP05GoldPathFixture(createP05GoldPathFixture());
}
