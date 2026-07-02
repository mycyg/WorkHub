import type { CommandId } from "./command-palette.js";
import { parseDesktopShellNavigatePayload } from "./shell-events.js";
import type { SpotlightHandle } from "./spotlight/controller.js";
import { capabilityForShellRoute, entityIdFromShellRoute } from "./spotlight/state.js";
import type { SpotlightTarget } from "./spotlight/view-context.js";

export type DesktopSpotlightProjectContextSaver = (route: string) => unknown;

export type DesktopSpotlightShellNavigationResult =
  | { kind: "open"; route: string; capability: CommandId; target: SpotlightTarget }
  | { kind: "reset"; route?: string };

export function handleDesktopSpotlightShellNavigate(
  payload: unknown,
  input: {
    spotlight: Pick<SpotlightHandle, "openCapability" | "reset">;
    saveProjectContextFromRoute?: DesktopSpotlightProjectContextSaver | undefined;
  }
): DesktopSpotlightShellNavigationResult {
  const parsed = parseDesktopShellNavigatePayload(payload);
  if (parsed) {
    input.saveProjectContextFromRoute?.(parsed.route);
  }

  const capability = parsed ? capabilityForShellRoute(parsed.route) : undefined;
  if (capability && parsed) {
    const id = entityIdFromShellRoute(parsed.route);
    const target = id ? { id, route: parsed.route } : { route: parsed.route };
    input.spotlight.openCapability(capability, target);
    return { kind: "open", route: parsed.route, capability, target };
  }

  input.spotlight.reset();
  return parsed ? { kind: "reset", route: parsed.route } : { kind: "reset" };
}
