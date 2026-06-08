import {
  createP05GoldPathFixture,
  p05GoldPathIds,
  validateP05GoldPathFixture
} from "@workhub/agent/fixtures";
import { goldPathSurfaceVmSchema, type GoldPathSurfaceVM } from "@workhub/contracts";
import { toCuuState } from "@workhub/events";

export { p05GoldPathIds };

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

  return goldPathSurfaceVmSchema.parse(surface);
}

export function getP05GoldPathFixture() {
  return validateP05GoldPathFixture(createP05GoldPathFixture());
}
