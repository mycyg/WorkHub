import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

import {
  createHomeReactRouteComponent,
  type HomeRouteComponentProps,
  type WorkHubLocale
} from "@workhub/ui/gold-path";

import type { WebRouteReadyResult } from "./routes.js";

export type ReactRouteMountReason = "initial" | "sse-props";

export type ReactRouteMountResult = {
  mounted: boolean;
  routeKey?: "home" | undefined;
  componentName?: "HomeRouteComponent" | undefined;
  mountCount: number;
  propsUpdateCount: number;
  reason?: ReactRouteMountReason | undefined;
};

const reactRuntimeName = "react-18-createRoot";
const dispatcherProbeActionId = "r4_react_mount_probe";

type ActiveReactMount = {
  host: HTMLElement;
  root: Root;
  routeKey: "home";
  mountCount: number;
  propsUpdateCount: number;
};

let activeMount: ActiveReactMount | undefined;
let totalMountCount = 0;

function setRuntimeMetric(key: string, value: unknown) {
  document.documentElement.dataset[key] = String(value);
}

function resetRuntimeMetrics() {
  setRuntimeMetric("r4ReactRealMount", false);
  setRuntimeMetric("r4ReactMountedRoute", "");
  setRuntimeMetric("r4ReactMountedComponent", "");
}

export function unmountReactRouteIsland() {
  if (!activeMount) {
    resetRuntimeMetrics();
    return;
  }
  activeMount.root.unmount();
  activeMount = undefined;
  resetRuntimeMetrics();
}

function ensureReactMountHost(boundary: HTMLElement) {
  let host = boundary.querySelector<HTMLElement>("[data-r4-react-mount-root]");
  if (host) {
    return host;
  }
  host = document.createElement("div");
  host.hidden = true;
  host.dataset.r4ReactMountRoot = "true";
  host.dataset.r4ReactRuntime = reactRuntimeName;
  boundary.append(host);
  return host;
}

function HomeReactMountProbe(input: {
  props: HomeRouteComponentProps;
  fingerprint: string;
  reason: ReactRouteMountReason;
  mountCount: number;
  propsUpdateCount: number;
}) {
  return createElement(
    "div",
    {
      "data-r4-react-mounted-component": "HomeRouteComponent",
      "data-r4-react-mounted-route": "home",
      "data-r4-react-runtime": reactRuntimeName,
      "data-r4-react-props-source": "typed-page-vm",
      "data-r4-react-props-fingerprint": input.fingerprint,
      "data-r4-react-last-update-reason": input.reason,
      "data-r4-react-mount-count": String(input.mountCount),
      "data-r4-react-props-update-count": String(input.propsUpdateCount),
      "data-r4-react-primary-action-count": String(input.props.primaryActions.length),
      "data-r4-react-queue-count": String(input.props.queueCount),
      "data-r4-react-background-run-count": String(input.props.backgroundRunCount)
    },
    createElement(
      "a",
      {
        href: "/api/r4/react-mount-probe",
        "data-action-id": dispatcherProbeActionId,
        "data-method": "POST",
        "data-r4-react-dispatcher-probe": "true"
      },
      dispatcherProbeActionId
    )
  );
}

function syncRuntimeMetrics(
  boundary: HTMLElement,
  host: HTMLElement,
  input: {
    fingerprint: string;
    reason: ReactRouteMountReason;
    mountCount: number;
    propsUpdateCount: number;
  }
) {
  const attrs = {
    r4ReactRealMount: "true",
    r4ReactRuntime: reactRuntimeName,
    r4ReactMountedRoute: "home",
    r4ReactMountedComponent: "HomeRouteComponent",
    r4ReactPropsSource: "typed-page-vm",
    r4ReactPropsFingerprint: input.fingerprint,
    r4ReactLastUpdateReason: input.reason,
    r4ReactMountCount: String(input.mountCount),
    r4ReactPropsUpdateCount: String(input.propsUpdateCount),
    r4ReactDispatcherProbeActionId: dispatcherProbeActionId
  };
  for (const [key, value] of Object.entries(attrs)) {
    boundary.dataset[key] = value;
    host.dataset[key] = value;
    setRuntimeMetric(key, value);
  }
}

export function mountReactRouteIsland(
  result: WebRouteReadyResult,
  locale: WorkHubLocale,
  reason: ReactRouteMountReason
): ReactRouteMountResult {
  if (result.match.key !== "home") {
    unmountReactRouteIsland();
    return {
      mounted: false,
      mountCount: totalMountCount,
      propsUpdateCount: activeMount?.propsUpdateCount ?? 0
    };
  }
  const boundary = document.getElementById("wh-r4-hydration-home");
  if (!(boundary instanceof HTMLElement)) {
    resetRuntimeMetrics();
    return {
      mounted: false,
      routeKey: "home",
      mountCount: totalMountCount,
      propsUpdateCount: activeMount?.propsUpdateCount ?? 0
    };
  }
  const host = ensureReactMountHost(boundary);
  if (!activeMount || activeMount.host !== host || activeMount.routeKey !== "home") {
    activeMount?.root.unmount();
    totalMountCount += 1;
    activeMount = {
      host,
      root: createRoot(host),
      routeKey: "home",
      mountCount: totalMountCount,
      propsUpdateCount: 0
    };
  } else if (reason === "sse-props") {
    activeMount.propsUpdateCount += 1;
  }

  const adapter = createHomeReactRouteComponent(result.surface.page_vms.attention, locale);
  syncRuntimeMetrics(boundary, host, {
    fingerprint: adapter.propsFingerprint,
    reason,
    mountCount: activeMount.mountCount,
    propsUpdateCount: activeMount.propsUpdateCount
  });
  const currentMount = activeMount;
  flushSync(() => {
    currentMount.root.render(
      createElement(HomeReactMountProbe, {
        props: adapter.props,
        fingerprint: adapter.propsFingerprint,
        reason,
        mountCount: currentMount.mountCount,
        propsUpdateCount: currentMount.propsUpdateCount
      })
    );
  });

  return {
    mounted: true,
    routeKey: "home",
    componentName: "HomeRouteComponent",
    mountCount: activeMount.mountCount,
    propsUpdateCount: activeMount.propsUpdateCount,
    reason
  };
}

export function hasMountedReactRoute(routeKey: "home") {
  return activeMount?.routeKey === routeKey;
}
