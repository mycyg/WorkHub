import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { clientDeviceRegisterRequestSchema } from "@workhub/contracts";

import {
  createRequireLocalClientMiddleware,
  getDefaultAuthDependencies,
  hashClientToken,
  makeClientToken,
  resolveAuthDependencies,
  resolveCurrentClientDevice,
  resolveCurrentUser,
  toClientDeviceResponse,
  type AuthDependencySource,
  type AuthEnv
} from "../middleware/auth.js";

export function createClientDeviceRoutes(source: AuthDependencySource = getDefaultAuthDependencies) {
  const routes = new Hono<AuthEnv>();

  routes.post("/register", async (c) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const payload = clientDeviceRegisterRequestSchema.parse(await c.req.json());
    const token = makeClientToken();
    const device = await deps.devices.createClientDevice({
      userId: user.id,
      deviceName: payload.device_name.trim(),
      platform: (payload.platform ?? "unknown").trim().slice(0, 64) || "unknown",
      clientTokenHash: hashClientToken(token),
      lastSeenAt: (deps.now ?? (() => new Date()))()
    });

    return c.json({ device: toClientDeviceResponse(device), client_token: token }, 201);
  });

  routes.get("/me", async (c) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const devices = await deps.devices.listByUser(user.id);
    return c.json(devices.map(toClientDeviceResponse));
  });

  routes.get("/current", createRequireLocalClientMiddleware(source), async (c) => {
    const device = c.var.currentClientDevice;
    if (!device) {
      throw new HTTPException(403, { message: "local client required" });
    }
    return c.json(toClientDeviceResponse(device));
  });

  routes.post("/:deviceId/revoke", async (c) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const device = await deps.devices.revokeByIdForUser(
      c.req.param("deviceId"),
      user.id,
      (deps.now ?? (() => new Date()))()
    );
    if (!device) {
      throw new HTTPException(404, { message: "client device not found" });
    }
    return c.json(toClientDeviceResponse(device));
  });

  routes.post("/revoke-current", async (c) => {
    const deps = resolveAuthDependencies(source);
    const user = await resolveCurrentUser(c, deps);
    const device = await resolveCurrentClientDevice(c, deps, user);
    const revoked = await deps.devices.revokeByIdForUser(
      device.id,
      user.id,
      (deps.now ?? (() => new Date()))()
    );
    if (!revoked) {
      throw new HTTPException(404, { message: "client device not found" });
    }
    return c.json(toClientDeviceResponse(revoked));
  });

  return routes;
}
