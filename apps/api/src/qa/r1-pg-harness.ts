/**
 * 真 PG 冒烟的共用基建。被 `qa:r1-pg-smoke`（agent run 全链）与
 * `qa:r1-pg-plugin-smoke`（插件治理全链）共用——两条门跑在**同一个容器、同一份 env** 上，
 * 所以起库、种子、鉴权、错误信封这四件事只该有一份实现。
 *
 * 这里刻意只放「每条真 PG 门都要做一遍」的东西：
 *   - `assertNotProduction`：真 PG 门会写库，绝不允许指着生产库跑；
 *   - `ensureDefaultSeed`：org / workspace / 管理员 / project 四行种子（幂等）；
 *   - `seedAdminHeaders`：种子管理员的签名 cookie；
 *   - `withErrors`：与 `app.ts` 的 onError **同口径**的错误信封（类型化服务错误按自己的
 *     status/code 出去，不被兜底压成无语义的 500）。
 *
 * 业务编排（造工单、跑 run、装插件）留在各自的冒烟脚本里——那才是各条门要证明的东西。
 */
import { Hono } from "hono";
import { generateSignedCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

import type { Settings } from "@workhub/config";
import {
  createDatabaseClient,
  defaultSeedFixture,
  orgs,
  projects,
  users,
  workspaces,
  type UserRepository
} from "@workhub/db";

import { COOKIE_NAME } from "../middleware/auth.js";
import { EscalationServiceError } from "../services/escalations.js";
import { PluginServiceError } from "../services/plugins.js";
import { ProposalServiceError } from "../services/proposals.js";
import { TaskPlanServiceError } from "../services/task-plans.js";

export type SmokeDb = ReturnType<typeof createDatabaseClient>["db"];

/** 真 PG 门会写库。指着生产库跑一次就够删数据了——这条守卫不做「警告」，直接拒跑。 */
export function assertNotProduction(settings: Settings, label: string) {
  if (settings.appEnv === "production") {
    throw new Error(`Refusing to run ${label} in production.`);
  }
}

/**
 * 与 `apps/api/src/app.ts` 的 onError 同口径：ZodError → 422 validation_error，
 * 四个类型化服务错误按自己的 status/code 出去，HTTPException 透传。
 * 冒烟自己拼 Hono app（只挂被测那几条路由），所以要显式带上这一份。
 */
export function withErrors<T extends { Variables: Record<string, unknown> }>(app: Hono<T>) {
  app.onError((error, c) => {
    if (error instanceof ZodError) {
      return c.json({ ok: false, error: { code: "validation_error", message: "invalid payload" } }, 422);
    }
    if (error instanceof EscalationServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof TaskPlanServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof ProposalServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof PluginServiceError) {
      return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as 400);
    }
    if (error instanceof HTTPException) {
      return c.json({ ok: false, error: { code: "http_error", message: error.message } }, error.status);
    }
    throw error;
  });
  return app;
}

/** org / workspace / 管理员 / project 四行种子。幂等——重复跑不会炸。 */
export async function ensureDefaultSeed(db: SmokeDb) {
  await db.insert(orgs).values(defaultSeedFixture.orgs).onConflictDoNothing();
  await db.insert(workspaces).values(defaultSeedFixture.workspaces).onConflictDoNothing();
  await db.insert(users).values(defaultSeedFixture.users).onConflictDoNothing();
  await db.insert(projects).values(defaultSeedFixture.projects).onConflictDoNothing();
}

export type SmokeAuthHeaders = { Cookie: string };

/**
 * 种子管理员的签名 cookie。
 *
 * `defaultSeedFixture` 的 cookieToken 是**每个进程随机生成**的（seed.ts 的 L36：种子管理员
 * 令牌不能是可预测的字面量），而 `ensureDefaultSeed` 是 onConflictDoNothing——所以在一个
 * 已经跑过一次的库上，库里存的是**上一次**那个进程的令牌，本进程签出来的 cookie 认不出来。
 * 这里显式轮换一次，让门在同一个库上可以重复跑（CI 每次都是新库，本机复跑才是常态）。
 */
export async function seedAdminHeaders(
  settings: Settings,
  userRepository: Pick<UserRepository, "rotateCookieToken">
): Promise<{ id: string; cookieToken: string; headers: SmokeAuthHeaders }> {
  const seedUser = defaultSeedFixture.users[0];
  if (!seedUser) {
    throw new Error("Default seed user is missing.");
  }
  await userRepository.rotateCookieToken(seedUser.id, seedUser.cookieToken);
  const cookie = await generateSignedCookie(COOKIE_NAME, seedUser.cookieToken, settings.auth.cookieSecret);
  return { id: seedUser.id, cookieToken: seedUser.cookieToken, headers: { Cookie: cookie } };
}

/** 任意用户的签名 cookie（冒烟里造非管理员时用）。 */
export async function signedCookieFor(settings: Settings, cookieToken: string): Promise<SmokeAuthHeaders> {
  const cookie = await generateSignedCookie(COOKIE_NAME, cookieToken, settings.auth.cookieSecret);
  return { Cookie: cookie };
}
