import { randomBytes } from "node:crypto";

import type { InferInsertModel } from "drizzle-orm";

import { orgs, projects, users, workspaces } from "./schema/index.js";

// L36：种子管理员的会话令牌不能是可预测的字面量——它是一份能直接登入 admin 的凭据，
// 写死后任何拿到源码的人都能伪造管理员 cookie。改为每次进程启动随机生成（QA 冒烟在同进程内
// 从 fixture 读取，因而保持一致；真实管理员仍走昵称 + admin_secret 注册流，不依赖此令牌）。
const seedAdminCookieToken = randomBytes(32).toString("hex");

export const defaultSeedIds = {
  orgId: "00000000-0000-4000-8000-000000000001",
  workspaceId: "00000000-0000-4000-8000-000000000002",
  adminUserId: "00000000-0000-4000-8000-000000000003",
  projectId: "00000000-0000-4000-8000-000000000004"
} as const;

export type DefaultSeedFixture = {
  orgs: InferInsertModel<typeof orgs>[];
  workspaces: InferInsertModel<typeof workspaces>[];
  users: InferInsertModel<typeof users>[];
  projects: InferInsertModel<typeof projects>[];
};

export const defaultSeedFixture = {
  orgs: [
    {
      id: defaultSeedIds.orgId,
      name: "WorkHub Local",
      slug: "workhub-local",
      plan: "lan"
    }
  ],
  workspaces: [
    {
      id: defaultSeedIds.workspaceId,
      orgId: defaultSeedIds.orgId,
      name: "Default Workspace",
      slug: "default"
    }
  ],
  users: [
    {
      id: defaultSeedIds.adminUserId,
      nickname: "owner",
      cookieToken: seedAdminCookieToken,
      availabilityStatus: "free",
      isAdmin: true
    }
  ],
  projects: [
    {
      id: defaultSeedIds.projectId,
      workspaceId: defaultSeedIds.workspaceId,
      name: "WorkHub Demo",
      slug: "demo",
      ownerNickname: "owner",
      ownerUserId: defaultSeedIds.adminUserId,
      archived: false,
      nextSeq: 0
    }
  ]
} satisfies DefaultSeedFixture;
