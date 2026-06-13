import { cssEscape } from "./html.js";

export type PostRunNextActionKind = "proposal" | "replay";

export type PostRunWorkItemClarityState = {
  routeVisible: boolean;
  workItemId?: string | undefined;
  actionKind?: PostRunNextActionKind | undefined;
  actionHref?: string | undefined;
  actionCount: number;
};

function actionKindFromElement(element: HTMLElement): PostRunNextActionKind | undefined {
  const marker = element.dataset.s1Day2PostRunNextAction;
  if (marker === "proposal" || marker === "replay") {
    return marker;
  }
  const actionId = element.dataset.actionId;
  if (actionId === "open_proposal") {
    return "proposal";
  }
  if (actionId === "open_replay") {
    return "replay";
  }
  return undefined;
}

function elementHref(element: HTMLElement) {
  const getAttribute = (element as HTMLElement & { getAttribute?: (name: string) => string | null }).getAttribute;
  return typeof getAttribute === "function" ? getAttribute.call(element, "href") ?? undefined : undefined;
}

export function inspectPostRunWorkItemClarity(scope: ParentNode, workItemId?: string): PostRunWorkItemClarityState {
  const selector = workItemId
    ? `[data-r4-route-component="workitem"][data-r4-workitem-id="${cssEscape(workItemId)}"]`
    : "[data-r4-route-component=\"workitem\"]";
  const route = scope.querySelector<HTMLElement>(selector);
  if (!route) {
    return {
      routeVisible: false,
      ...(workItemId ? { workItemId } : {}),
      actionCount: 0
    };
  }

  const actions = Array.from(route.querySelectorAll<HTMLElement>(
    "[data-s1-day2-post-run-next-action], [data-action-id=\"open_proposal\"], [data-action-id=\"open_replay\"]"
  ));
  const first = actions.find((action) => actionKindFromElement(action));
  const kind = first ? actionKindFromElement(first) : undefined;
  const href = first ? elementHref(first) : undefined;

  return {
    routeVisible: true,
    workItemId: route.dataset.r4WorkitemId ?? workItemId,
    ...(kind ? { actionKind: kind } : {}),
    ...(href ? { actionHref: href } : {}),
    actionCount: actions.length
  };
}
