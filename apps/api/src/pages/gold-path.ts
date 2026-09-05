import {
  createP05GoldPathFixture,
  p05GoldPathIds,
  validateP05GoldPathFixture
} from "@workhub/agent/fixtures";
import { goldPathSurfaceVmSchema, type GoldPathSurfaceVM, type WorkHubLocale } from "@workhub/contracts";
import { toCuuState } from "@workhub/events";
import { generatedEnglishCopy } from "./gold-path-copy.js";
import { parseOutputContract } from "./output-contract.js";

export { p05GoldPathIds };

function productCopy(value: string) {
  return value
    // A2-66：Cuu 是产品对外的角色名（界面到处都在用），此前被机械替成英文 "AI assistant"，
    // 让中文串里混出英文署名。保留原名，只做示例业务名的脱敏替换。
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
