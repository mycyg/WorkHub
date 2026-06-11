import {
  createP05GoldPathFixture,
  p05GoldPathIds,
  validateP05GoldPathFixture
} from "@workhub/agent/fixtures";
import { goldPathSurfaceVmSchema, type GoldPathSurfaceVM } from "@workhub/contracts";
import { toCuuState } from "@workhub/events";

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

export function buildP05GoldPathSurfacePage(): GoldPathSurfaceVM {
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
      cost: "/dashboard/cost"
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

  return goldPathSurfaceVmSchema.parse(productizeSurface(surface));
}

export function getP05GoldPathFixture() {
  return validateP05GoldPathFixture(createP05GoldPathFixture());
}
