export type LiveMetricWriter = (key: string, value: unknown) => void;

export function clearLiveDirtyMetrics(setMetric: LiveMetricWriter) {
  setMetric("r4LiveRouteDirty", false);
  setMetric("r4LiveDirtyRoute", "");
  setMetric("r4LiveDirtyReason", "");
  setMetric("r4LiveDirtyPendingEvent", "");
  setMetric("r4LiveDirtyPendingStream", "");
}

export function activeRouteElement(root: ParentNode | null | undefined) {
  return root?.querySelector<HTMLElement>("[data-r4-route-component]");
}

export function markActiveRouteDirty(
  root: ParentNode | null | undefined,
  setMetric: LiveMetricWriter,
  reason: string
) {
  const route = activeRouteElement(root);
  if (!route) {
    return;
  }
  route.dataset.r4RouteDirty = "true";
  route.dataset.r4RouteDirtyReason = reason;
  setMetric("r4LiveRouteDirty", true);
  setMetric("r4LiveDirtyRoute", route.dataset.r4RouteComponent ?? "");
  setMetric("r4LiveDirtyReason", reason);
}

export function clearActiveRouteDirty(root: ParentNode | null | undefined, setMetric: LiveMetricWriter) {
  const route = activeRouteElement(root);
  if (route) {
    delete route.dataset.r4RouteDirty;
    delete route.dataset.r4RouteDirtyReason;
  }
  clearLiveDirtyMetrics(setMetric);
}

export function activeRouteHasDirtyEdits(root: ParentNode | null | undefined) {
  return activeRouteElement(root)?.dataset.r4RouteDirty === "true";
}
