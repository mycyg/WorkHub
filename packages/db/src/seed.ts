import type { InferInsertModel } from "drizzle-orm";

import { orgs, projects, users, workspaces } from "./schema/index.js";

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
      cookieToken: "dev-cookie-token-change-me",
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
